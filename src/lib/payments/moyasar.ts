import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CreateChargeArgs,
  CreateChargeResult,
  PaymentProvider,
  ProviderEvent,
  ProviderEventType,
} from "./provider.js";

// Moyasar adapter (research.md §1/§2/§8). The single concrete provider behind the
// PaymentProvider interface for production:
//
//   - createCharge → REST POST to the Moyasar payments API via fetch, carrying our
//     metadata so the webhook resolves the family from the event (FR-011).
//   - verifyWebhook → Node crypto HMAC over the RAW request bytes with
//     timingSafeEqual (no SDK, no timing leak; FR-007).
//   - parseEvent → map Moyasar's payload fields to our normalized ProviderEvent
//     (only after verification).
//
// SAR is minor-unit native (halalas), matching our amountMinor columns.

const MOYASAR_API_BASE = "https://api.moyasar.com/v1";

interface MoyasarConfig {
  secretKey: string;
  webhookSecret: string;
  apiBase?: string;
  /** Where Moyasar's hosted invoice page returns the user after pay/cancel. */
  returnUrl?: string;
}

/** Map Moyasar's event/payment status to our logical event type. */
function mapEventType(raw: { type?: string; status?: string }): ProviderEventType {
  // Moyasar webhooks carry a `type` like "payment_paid" / "payment_failed" /
  // "payment_refunded"; fall back to the payment status if absent.
  const t = (raw.type ?? raw.status ?? "").toLowerCase();
  if (t.includes("refund")) return "refunded";
  if (t.includes("dispute") || t.includes("chargeback")) return "disputed";
  if (t.includes("fail")) return "payment_failed";
  if (t.includes("renewal") || t.includes("recurring")) return "renewal_succeeded";
  // "payment_paid" / "paid" / "captured" → succeeded
  return "payment_succeeded";
}

export function createMoyasarProvider(cfg: MoyasarConfig): PaymentProvider {
  const apiBase = cfg.apiBase ?? MOYASAR_API_BASE;

  return {
    async createCharge(args: CreateChargeArgs): Promise<CreateChargeResult> {
      // Basic auth: the secret key as the username, empty password.
      const auth = Buffer.from(`${cfg.secretKey}:`).toString("base64");

      // A saved-method token can be charged directly via the Payments API. Without a
      // token we must collect the card on Moyasar's side: the Payments API requires a
      // `source` we don't have, so we create a hosted Invoice instead, which returns a
      // `url` to redirect the user to (where Moyasar collects the card / runs 3-DS).
      if (args.methodRef) {
        const res = await fetch(`${apiBase}/payments`, {
          method: "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: args.amountMinor,
            currency: args.currency,
            description: args.description,
            metadata: args.metadata,
            source: { type: "token", token: args.methodRef },
          }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`Moyasar createCharge failed (${res.status}): ${detail}`);
        }
        const body = (await res.json()) as {
          id: string;
          source?: { transaction_url?: string };
        };
        return {
          providerRef: body.id,
          ...(body.source?.transaction_url ? { redirectUrl: body.source.transaction_url } : {}),
        };
      }

      // Hosted checkout via Invoice (no saved method). Moyasar requires SAR amounts to
      // be multiples of 10 halalas; round up so the user is never undercharged.
      const amount = Math.ceil(args.amountMinor / 10) * 10;
      const res = await fetch(`${apiBase}/invoices`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          currency: args.currency,
          description: args.description,
          metadata: args.metadata,
          ...(cfg.returnUrl
            ? { success_url: cfg.returnUrl, back_url: cfg.returnUrl }
            : {}),
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Moyasar createInvoice failed (${res.status}): ${detail}`);
      }

      const body = (await res.json()) as { id: string; url?: string };
      return {
        providerRef: body.id,
        ...(body.url ? { redirectUrl: body.url } : {}),
      };
    },

    verifyWebhook(rawBody: Buffer, signatureHeader: string | undefined): boolean {
      if (!signatureHeader || !cfg.webhookSecret) return false;
      const expected = createHmac("sha256", cfg.webhookSecret).update(rawBody).digest("hex");
      const a = Buffer.from(signatureHeader);
      const b = Buffer.from(expected);
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    },

    parseEvent(rawBody: Buffer): ProviderEvent {
      const raw = JSON.parse(rawBody.toString("utf-8")) as {
        id: string;
        type?: string;
        data?: {
          id?: string;
          status?: string;
          amount?: number;
          currency?: string;
          metadata?: Record<string, string>;
        };
      };
      const data = raw.data ?? {};
      return {
        id: raw.id,
        type: mapEventType({ ...(raw.type ? { type: raw.type } : {}), ...(data.status ? { status: data.status } : {}) }),
        data: {
          providerRef: data.id ?? "",
          ...(data.amount !== undefined ? { amountMinor: data.amount } : {}),
          ...(data.currency ? { currency: data.currency } : {}),
          ...(data.metadata ? { metadata: data.metadata } : {}),
        },
      };
    },
  };
}
