import prisma from "../../db/prisma.js";
import {
  NotFoundError,
  SubscriptionAlreadyActiveError,
  ProrationUncomputableError,
  RetainWindowElapsedError,
} from "../../lib/errors.js";
import type { Subscription, Invoice, Plan } from "../../generated/prisma/client.js";
import { getPaymentProvider } from "../../lib/payments/index.js";
import type { ChargeMetadata } from "../../lib/payments/provider.js";
import { prorate } from "../../lib/proration.js";
import config from "../../config/index.js";
import { getSlotUsage } from "../children/children.service.js";
import { PLAN_KEY_MAP } from "../onboarding/onboarding.schema.js";
import type {
  InitiateInput,
  OverflowUpgradeInput,
  PlanChangeInput,
  PaymentMethodInput,
} from "./billing.schema.js";

// Billing service — the sole Prisma toucher for the parent-facing billing module
// (Principle II). Every exported fn takes `familyId` from `req.principal`; per-row
// reads/writes are family-scoped via findFirst so a foreign id is an indistinguishable
// 404 (Principle I, data-model.md §4). This service NEVER sets subscription status to
// ACTIVE/PAST_DUE — those transitions originate only from the verified webhook
// (Principle VI); cancel/reactivate are the only parent-set status changes (no payment).

// ── Family-scope guards (data-model.md §4, Principle I) ───────────────────────

/**
 * Load the caller's family subscription, scoped by familyId. A family with no
 * subscription (or a soft-deleted one) is a 404 — never another family's row.
 */
export async function assertSubscriptionInFamily(familyId: string): Promise<Subscription> {
  const subscription = await prisma.subscription.findFirst({
    where: { familyId, deletedAt: null },
  });
  if (!subscription) {
    throw new NotFoundError("Subscription not found");
  }
  return subscription;
}

/**
 * Load an invoice by id only if it belongs to the caller's family (via its
 * subscription). A foreign / unknown id is an indistinguishable 404 (FR-024).
 */
export async function assertInvoiceInFamily(
  familyId: string,
  invoiceId: string,
): Promise<Invoice> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, subscription: { familyId, deletedAt: null } },
  });
  if (!invoice) {
    throw new NotFoundError("Invoice not found");
  }
  return invoice;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/** The full subscription price for a plan at the stored cycle, in minor units. */
function planPriceMinor(plan: Plan, cycle: Subscription["billingCycle"]): number {
  return cycle === "YEARLY" ? plan.yearlyPriceMinor : plan.monthlyPriceMinor;
}

function chargeMetadata(args: {
  familyId: string;
  subscriptionId: string;
  intentId: string;
  purpose: ChargeMetadata["purpose"];
  extra?: Record<string, string>;
}): ChargeMetadata {
  return {
    familyId: args.familyId,
    subscriptionId: args.subscriptionId,
    intentId: args.intentId,
    purpose: args.purpose,
    ...(args.extra ?? {}),
  };
}

export interface InitiateResult {
  intentId: string;
  providerRef: string;
  redirectUrl: string | undefined;
  expectedAmountMinor: number;
  currency: string;
}

export interface ProrationQuoteResult {
  intentId: string;
  providerRef: string;
  redirectUrl: string | undefined;
  proratedAmountMinor: number;
  currency: string;
  remainingDays: number;
  effectiveAt: string;
}

// ── US1: Initiate (FR-001/002, data-model.md §3) ──────────────────────────────

/**
 * Create a PaymentIntent(ACTIVATION) + provider charge for the server-computed amount
 * and return the provider ref/redirect. Performs NO activation — the subscription
 * stays PENDING until the verified webhook arrives (Principle VI). Rejects 409 if the
 * subscription is already ACTIVE.
 */
export async function initiate(familyId: string, input: InitiateInput): Promise<InitiateResult> {
  const subscription = await prisma.subscription.findFirst({
    where: { familyId, deletedAt: null },
    include: { plan: true },
  });
  if (!subscription || !subscription.plan) {
    throw new NotFoundError("Subscription not found");
  }
  if (subscription.status === "ACTIVE") {
    throw new SubscriptionAlreadyActiveError();
  }

  const amountMinor = planPriceMinor(subscription.plan, subscription.billingCycle);
  const currency = subscription.plan.currency;

  const intent = await prisma.paymentIntent.create({
    data: {
      familyId,
      subscriptionId: subscription.id,
      purpose: "ACTIVATION",
      expectedAmountMinor: amountMinor,
      currency,
      providerRef: "", // filled after the provider call
      status: "CREATED",
    },
  });

  const provider = getPaymentProvider();
  const charge = await provider.createCharge({
    amountMinor,
    currency,
    description: `${subscription.plan.name} plan activation`,
    metadata: chargeMetadata({
      familyId,
      subscriptionId: subscription.id,
      intentId: intent.id,
      purpose: "ACTIVATION",
    }),
    ...(input.methodRef ? { methodRef: input.methodRef } : {}),
  });

  await prisma.paymentIntent.update({
    where: { id: intent.id },
    data: { providerRef: charge.providerRef },
  });

  return {
    intentId: intent.id,
    providerRef: charge.providerRef,
    redirectUrl: charge.redirectUrl,
    expectedAmountMinor: amountMinor,
    currency,
  };
}

// ── US3: Overflow upgrade (FR-012/013/014, data-model.md §3) ──────────────────

/**
 * Confirm the family is at its plan slot limit, compute the prorated +SAR 25 overflow
 * charge server-side, and create a PaymentIntent(OVERFLOW) carrying the childDraftId.
 * The slot is granted only on the verified overflow webhook (FR-014).
 */
export async function overflowUpgrade(
  familyId: string,
  input: OverflowUpgradeInput,
  now: Date = new Date(),
): Promise<ProrationQuoteResult> {
  const subscription = await prisma.subscription.findFirst({
    where: { familyId, deletedAt: null },
    include: { plan: true },
  });
  if (!subscription || !subscription.plan) {
    throw new NotFoundError("Subscription not found");
  }

  const { atLimit } = await getSlotUsage(familyId);
  if (!atLimit) {
    // Not at the limit → there's a free slot; overflow doesn't apply (422).
    throw new ProrationUncomputableError("Family is not at its plan's child-slot limit");
  }

  const { amountMinor, remainingDays } = prorate(
    config.OVERFLOW_PRICE_MINOR,
    subscription.billingCycle,
    subscription.currentPeriodEnd,
    now,
  );
  const currency = subscription.plan.currency;

  const intent = await prisma.paymentIntent.create({
    data: {
      familyId,
      subscriptionId: subscription.id,
      purpose: "OVERFLOW",
      expectedAmountMinor: amountMinor,
      currency,
      providerRef: "",
      status: "CREATED",
      metadata: { childDraftId: input.childDraftId },
    },
  });

  const provider = getPaymentProvider();
  const charge = await provider.createCharge({
    amountMinor,
    currency,
    description: "Additional child slot (prorated)",
    metadata: chargeMetadata({
      familyId,
      subscriptionId: subscription.id,
      intentId: intent.id,
      purpose: "OVERFLOW",
      extra: { childDraftId: input.childDraftId },
    }),
  });

  await prisma.paymentIntent.update({
    where: { id: intent.id },
    data: { providerRef: charge.providerRef },
  });

  return {
    intentId: intent.id,
    providerRef: charge.providerRef,
    redirectUrl: charge.redirectUrl,
    proratedAmountMinor: amountMinor,
    currency,
    remainingDays,
    effectiveAt: subscription.currentPeriodEnd.toISOString(),
  };
}

// ── US3: Plan change (FR-015/016) ─────────────────────────────────────────────

/**
 * Compute the prorated price DIFFERENCE between the target plan and the current plan
 * for the remaining period, server-side, and create a PaymentIntent(UPGRADE). A
 * client-supplied amount is never accepted. The plan swap applies on the verified
 * webhook. A non-positive difference (downgrade) yields a clean 422 here (the
 * downgrade applies at its effective point — modeled as no immediate charge).
 */
export async function planChange(
  familyId: string,
  input: PlanChangeInput,
  now: Date = new Date(),
): Promise<ProrationQuoteResult> {
  const subscription = await prisma.subscription.findFirst({
    where: { familyId, deletedAt: null },
    include: { plan: true },
  });
  if (!subscription || !subscription.plan) {
    throw new NotFoundError("Subscription not found");
  }

  const targetKey = PLAN_KEY_MAP[input.targetPlan];
  const targetPlan = await prisma.plan.findUnique({ where: { key: targetKey } });
  if (!targetPlan) {
    throw new ProrationUncomputableError("Unknown target plan");
  }

  const cycle = input.billingCycle ?? subscription.billingCycle;
  const currentPrice = planPriceMinor(subscription.plan, cycle);
  const targetPrice = planPriceMinor(targetPlan, cycle);
  const fullDifference = targetPrice - currentPrice;

  if (fullDifference <= 0) {
    // Downgrade / no-cost change — no prorated charge is created here; the lower price
    // applies at the next period. Surface a clean 422 so the FE shows "applies next cycle".
    throw new ProrationUncomputableError("Downgrades apply at the next billing cycle, no charge");
  }

  const { amountMinor, remainingDays } = prorate(
    fullDifference,
    cycle,
    subscription.currentPeriodEnd,
    now,
  );
  const currency = targetPlan.currency;

  const intent = await prisma.paymentIntent.create({
    data: {
      familyId,
      subscriptionId: subscription.id,
      purpose: "UPGRADE",
      expectedAmountMinor: amountMinor,
      currency,
      providerRef: "",
      status: "CREATED",
      metadata: { targetPlanId: targetPlan.id },
    },
  });

  const provider = getPaymentProvider();
  const charge = await provider.createCharge({
    amountMinor,
    currency,
    description: `Upgrade to ${targetPlan.name} (prorated)`,
    metadata: chargeMetadata({
      familyId,
      subscriptionId: subscription.id,
      intentId: intent.id,
      purpose: "UPGRADE",
      extra: { targetPlanId: targetPlan.id },
    }),
  });

  await prisma.paymentIntent.update({
    where: { id: intent.id },
    data: { providerRef: charge.providerRef },
  });

  return {
    intentId: intent.id,
    providerRef: charge.providerRef,
    redirectUrl: charge.redirectUrl,
    proratedAmountMinor: amountMinor,
    currency,
    remainingDays,
    effectiveAt: subscription.currentPeriodEnd.toISOString(),
  };
}

// ── US4: Billing history + invoice (FR-018/019, data-model.md §5) ─────────────

export interface BillingHistoryPayload {
  subscription: {
    status: Subscription["status"];
    planName: string;
    childLimit: number;
    childSlotsUsed: number;
    currentPeriodEnd: string;
    canceledEffectiveAt: string | null;
  };
  paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
    isDefault: boolean;
  } | null;
  invoices: Array<{
    id: string;
    issuedAt: string;
    amountMinor: number;
    currency: string;
    status: Invoice["status"];
  }>;
}

export async function getBillingHistory(familyId: string): Promise<BillingHistoryPayload> {
  const subscription = await prisma.subscription.findFirst({
    where: { familyId, deletedAt: null },
    include: { plan: true, invoices: { orderBy: { issuedAt: "desc" } } },
  });
  if (!subscription || !subscription.plan) {
    throw new NotFoundError("Subscription not found");
  }

  const method = await prisma.paymentMethod.findFirst({
    where: { familyId, isDefault: true },
    orderBy: { updatedAt: "desc" },
  });

  const childSlotsUsed = await prisma.child.count({ where: { familyId, deletedAt: null } });

  return {
    subscription: {
      status: subscription.status,
      planName: `${subscription.plan.name} Plan`,
      childLimit: subscription.plan.childLimit,
      childSlotsUsed,
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      canceledEffectiveAt: subscription.canceledEffectiveAt
        ? subscription.canceledEffectiveAt.toISOString()
        : null,
    },
    paymentMethod: method
      ? {
          brand: method.brand,
          last4: method.last4,
          expMonth: method.expMonth,
          expYear: method.expYear,
          isDefault: method.isDefault,
        }
      : null,
    invoices: subscription.invoices.map((inv) => ({
      id: inv.id,
      issuedAt: inv.issuedAt.toISOString(),
      amountMinor: inv.amountMinor,
      currency: inv.currency,
      status: inv.status,
    })),
  };
}

export interface InvoicePayload {
  id: string;
  issuedAt: string;
  amountMinor: number;
  currency: string;
  status: Invoice["status"];
}

export async function getInvoice(familyId: string, invoiceId: string): Promise<InvoicePayload> {
  const invoice = await assertInvoiceInFamily(familyId, invoiceId);
  return {
    id: invoice.id,
    issuedAt: invoice.issuedAt.toISOString(),
    amountMinor: invoice.amountMinor,
    currency: invoice.currency,
    status: invoice.status,
  };
}

// ── US4: Payment method (FR-020/027) ──────────────────────────────────────────

export interface PaymentMethodPayload {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

/**
 * Upsert the family's default payment method storing ONLY the provider reference +
 * display fields — never a PAN (FR-027). Brand/last4/expiry come from the provider
 * token lookup; here we persist what the provider returns as display-safe defaults.
 */
export async function changePaymentMethod(
  familyId: string,
  input: PaymentMethodInput,
): Promise<PaymentMethodPayload> {
  await assertSubscriptionInFamily(familyId);

  // Demote any existing defaults, then store the new method as default. The display
  // fields are placeholders until a provider token lookup is wired; no PAN is involved.
  const existing = await prisma.paymentMethod.findFirst({
    where: { familyId, providerMethodRef: input.providerMethodRef },
  });

  await prisma.paymentMethod.updateMany({
    where: { familyId, isDefault: true },
    data: { isDefault: false },
  });

  const method = existing
    ? await prisma.paymentMethod.update({
        where: { id: existing.id },
        data: { isDefault: true },
      })
    : await prisma.paymentMethod.create({
        data: {
          familyId,
          providerMethodRef: input.providerMethodRef,
          brand: "card",
          last4: "0000",
          expMonth: 1,
          expYear: 2099,
          isDefault: true,
        },
      });

  return {
    brand: method.brand,
    last4: method.last4,
    expMonth: method.expMonth,
    expYear: method.expYear,
    isDefault: method.isDefault,
  };
}

// ── US4: Cancel / reactivate (FR-021/022, data-model.md §3) ───────────────────

export interface CancelResult {
  status: "CANCELED";
  canceledEffectiveAt: string;
}

/**
 * Cancel the subscription, retaining access to the paid period end and marking for the
 * Phase 6 purge — NO delete (FR-021). Sets canceledAt=now, canceledEffectiveAt=
 * currentPeriodEnd, status=CANCELED; renewals stop because the webhook only renews
 * ACTIVE subscriptions.
 */
export async function cancel(familyId: string, now: Date = new Date()): Promise<CancelResult> {
  const subscription = await assertSubscriptionInFamily(familyId);

  const updated = await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: "CANCELED",
      canceledAt: now,
      canceledEffectiveAt: subscription.currentPeriodEnd,
    },
  });

  return {
    status: "CANCELED",
    canceledEffectiveAt: updated.canceledEffectiveAt!.toISOString(),
  };
}

/**
 * Reactivate a canceled subscription within its retain window (access still valid,
 * i.e. canceledEffectiveAt in the future): clears canceledAt/canceledEffectiveAt and
 * restores ACTIVE. After the window → RETAIN_WINDOW_ELAPSED (422) (FR-022).
 */
export async function reactivate(
  familyId: string,
  now: Date = new Date(),
): Promise<BillingHistoryPayload> {
  const subscription = await assertSubscriptionInFamily(familyId);

  if (subscription.status !== "CANCELED" || !subscription.canceledEffectiveAt) {
    throw new RetainWindowElapsedError("Subscription is not in a reactivatable state");
  }
  if (subscription.canceledEffectiveAt.getTime() <= now.getTime()) {
    throw new RetainWindowElapsedError("The reactivation window has elapsed");
  }

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { status: "ACTIVE", canceledAt: null, canceledEffectiveAt: null },
  });

  return getBillingHistory(familyId);
}
