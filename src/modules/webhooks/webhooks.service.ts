import pino from "pino";
import { Prisma } from "../../generated/prisma/client.js";
import type {
  PaymentIntent,
  Subscription,
  SubscriptionStatus,
} from "../../generated/prisma/client.js";
import prisma from "../../db/prisma.js";
import { getPaymentProvider } from "../../lib/payments/index.js";
import type { ProviderEvent } from "../../lib/payments/provider.js";
import { resolveTransition } from "./transition.js";
import { providerEventSchema } from "./webhooks.schema.js";
import { WebhookSignatureInvalidError } from "../../lib/errors.js";

const logger = pino({ name: "webhooks.service" });

// The single webhook receiver and the ONLY code path that drives subscription status
// (Principle VI). Fixed pipeline (research.md §2/§3, data-model.md §2):
//
//   verify signature (raw bytes) → insert WebhookEvent (dedup) → parse event →
//   resolve PaymentIntent/family from providerRef+metadata → apply transition + invoice
//
// all inside one transaction so the ledger insert and the effect commit together: a
// crash after the effect can't double-apply (the unique row already exists), and a
// duplicate delivery is a safe no-op (FR-007/008/010/011).

const PERIOD_MS: Record<Subscription["billingCycle"], number> = {
  MONTHLY: 30 * 24 * 60 * 60 * 1000,
  YEARLY: 365 * 24 * 60 * 60 * 1000,
};

/** Extend from the later of "now" and the current period end, so an early renewal
 * stacks onto the remaining time rather than truncating it. */
function extendedPeriodEnd(sub: Subscription, now: Date): Date {
  const base = sub.currentPeriodEnd.getTime() > now.getTime() ? sub.currentPeriodEnd : now;
  return new Date(base.getTime() + PERIOD_MS[sub.billingCycle]);
}

/** A fresh period end measured from now (used on first activation from PENDING). */
function freshPeriodEnd(sub: Subscription, now: Date): Date {
  return new Date(now.getTime() + PERIOD_MS[sub.billingCycle]);
}

/**
 * Verify, dedup, and process a provider webhook. Throws WebhookSignatureInvalidError
 * on a bad/absent signature (→ 400). Any other throw is a transient failure (→ 500,
 * provider retries). A duplicate event resolves to a silent no-op (→ 200).
 */
export async function processWebhook(
  rawBody: Buffer,
  signature: string | undefined,
  now: Date = new Date(),
): Promise<void> {
  const provider = getPaymentProvider();

  // 1) Signature over the raw bytes — before any parse or DB work (FR-007).
  if (!provider.verifyWebhook(rawBody, signature)) {
    throw new WebhookSignatureInvalidError();
  }

  // 2) Parse only after verification (FR-007), then validate the shape (Principle III).
  const event = providerEventSchema.parse(provider.parseEvent(rawBody)) as ProviderEvent;

  // 3+4+5) Dedup ledger + resolve + apply, all in one transaction.
  await prisma.$transaction(async (tx) => {
    // Insert the ledger row first; a unique violation means duplicate/replay → no-op.
    try {
      await tx.webhookEvent.create({
        data: { providerEventId: event.id, type: event.type },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        logger.info({ providerEventId: event.id }, "duplicate webhook event — no-op");
        return; // idempotent: first-seen already applied the effect
      }
      throw err;
    }

    await applyEvent(tx, event, now);

    await tx.webhookEvent.update({
      where: { providerEventId: event.id },
      data: { processedAt: now },
    });
  });
}

type Tx = Prisma.TransactionClient;

/** Resolve the intent + subscription from the event, then apply the transition. */
async function applyEvent(tx: Tx, event: ProviderEvent, now: Date): Promise<void> {
  const providerRef = event.data.providerRef;
  const metadataIntentId = event.data.metadata?.intentId;

  // Resolve the PaymentIntent by intentId metadata first (most precise), else providerRef.
  const intent = metadataIntentId
    ? await tx.paymentIntent.findFirst({ where: { id: metadataIntentId } })
    : await tx.paymentIntent.findFirst({ where: { providerRef } });

  if (!intent) {
    // No matching intent. For renewal/refund on a recurring subscription we may still
    // act via the subscription metadata; otherwise nothing to do (still 200 — we don't
    // leak, and the provider shouldn't retry a well-formed but unmatched event).
    const subId = event.data.metadata?.subscriptionId;
    if (!subId) {
      logger.warn({ providerRef, type: event.type }, "no intent/subscription resolved — no-op");
      return;
    }
    const subscription = await tx.subscription.findFirst({ where: { id: subId } });
    if (!subscription) return;
    await applyLifecycleOnly(tx, subscription, event);
    return;
  }

  const subscription = await tx.subscription.findFirst({
    where: { id: intent.subscriptionId },
  });
  if (!subscription) {
    logger.warn({ intentId: intent.id }, "intent has no subscription — no-op");
    return;
  }

  // Amount-mismatch guard for charges that carry an amount (FR-017): flag, do not
  // activate. We record the intent FAILED so the parent can retry; no invoice, no
  // status change.
  const reportedAmount = event.data.amountMinor;
  const isSuccess =
    event.type === "payment_succeeded" || event.type === "renewal_succeeded";
  if (isSuccess && reportedAmount !== undefined && reportedAmount !== intent.expectedAmountMinor) {
    logger.warn(
      { intentId: intent.id, expected: intent.expectedAmountMinor, reported: reportedAmount },
      "amount mismatch — flagging, not activating (FR-017)",
    );
    await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "FAILED" } });
    return;
  }

  await applyIntentEffect(tx, intent, subscription, event, now);
}

/**
 * Apply the effect of an event tied to a specific PaymentIntent, branching on the
 * intent purpose (data-model.md §2 transition table).
 */
async function applyIntentEffect(
  tx: Tx,
  intent: PaymentIntent,
  subscription: Subscription,
  event: ProviderEvent,
  now: Date,
): Promise<void> {
  const succeeded =
    event.type === "payment_succeeded" || event.type === "renewal_succeeded";

  if (!succeeded) {
    // Failure on a pending activation leaves PENDING (retryable, no invoice).
    await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "FAILED" } });
    // A failure/dispute/refund against an ACTIVE sub still drives lifecycle below.
    await applyLifecycleOnly(tx, subscription, event);
    return;
  }

  // Mark the intent succeeded (idempotency is guaranteed by the event ledger).
  await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "SUCCEEDED" } });

  switch (intent.purpose) {
    case "ACTIVATION": {
      // PENDING → ACTIVE: set the real period end, write a PAID invoice, children usable.
      const periodEnd =
        subscription.status === "PENDING"
          ? freshPeriodEnd(subscription, now)
          : extendedPeriodEnd(subscription, now);
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: "ACTIVE", currentPeriodEnd: periodEnd },
      });
      await writePaidInvoice(tx, subscription.id, intent.expectedAmountMinor, intent.currency, now);
      break;
    }
    case "RENEWAL": {
      // ACTIVE renewal: extend the period and add a new PAID invoice.
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: "ACTIVE", currentPeriodEnd: extendedPeriodEnd(subscription, now) },
      });
      await writePaidInvoice(tx, subscription.id, intent.expectedAmountMinor, intent.currency, now);
      break;
    }
    case "OVERFLOW": {
      // Grant the overflow slot; the drafted child is activated by the FE/children flow
      // once the slot exists. We bump childSlotsUsed (FR-014). Status unchanged.
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { childSlotsUsed: { increment: 1 } },
      });
      await writePaidInvoice(tx, subscription.id, intent.expectedAmountMinor, intent.currency, now);
      break;
    }
    case "UPGRADE": {
      // Swap to the target plan recorded on the intent metadata; recompute period.
      const targetPlanId = (intent.metadata as { targetPlanId?: string } | null)?.targetPlanId;
      if (targetPlanId) {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { planId: targetPlanId, status: "ACTIVE" },
        });
      }
      await writePaidInvoice(tx, subscription.id, intent.expectedAmountMinor, intent.currency, now);
      break;
    }
  }
}

/**
 * Lifecycle transitions that are keyed off the subscription's current status + event
 * type (no purpose-specific effect): failure/dispute → PAST_DUE, recovery → ACTIVE,
 * refund → access removed + invoice VOID (data-model.md §2).
 */
async function applyLifecycleOnly(
  tx: Tx,
  subscription: Subscription,
  event: ProviderEvent,
): Promise<void> {
  const next: SubscriptionStatus | null = resolveTransition(subscription.status, event.type);
  if (!next) return; // no defined transition → no-op

  if (event.type === "refunded") {
    // Void the most recent paid invoice and remove access.
    const lastPaid = await tx.invoice.findFirst({
      where: { subscriptionId: subscription.id, status: "PAID" },
      orderBy: { issuedAt: "desc" },
    });
    if (lastPaid) {
      await tx.invoice.update({ where: { id: lastPaid.id }, data: { status: "VOID" } });
    }
  }

  // Status-only transition (PAST_DUE on failure/dispute; ACTIVE on recovery). Recovery
  // that carries a fresh charge arrives via an intent and is handled in applyIntentEffect
  // (which writes the PAID invoice); here we only restore/lower the status.
  await tx.subscription.update({ where: { id: subscription.id }, data: { status: next } });
}

async function writePaidInvoice(
  tx: Tx,
  subscriptionId: string,
  amountMinor: number,
  currency: string,
  now: Date,
): Promise<void> {
  await tx.invoice.create({
    data: {
      subscriptionId,
      issuedAt: now,
      amountMinor,
      currency,
      status: "PAID",
    },
  });
}
