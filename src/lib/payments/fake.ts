import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CreateChargeArgs,
  CreateChargeResult,
  PaymentProvider,
  ProviderEvent,
} from "./provider.js";

// In-memory deterministic fake provider (research.md §1; the test default).
//
// - createCharge returns a deterministic providerRef derived from the intentId, so a
//   test can predict the ref and craft the matching webhook without a network call.
// - verifyWebhook/parseEvent use a deterministic HMAC over the raw bytes with a fixed
//   secret, so a test can SIGN an event offline (signFakeEvent) and have the server
//   verify it — exercising the real raw-body → verify → parse pipeline.
//
// No real charge is performed; nothing leaves the process.

/** The fixed HMAC secret used when PAYMENT_WEBHOOK_SECRET is absent (dev/test). */
export const FAKE_WEBHOOK_SECRET = "fake-webhook-secret";

/** Deterministic provider charge ref for an intent — predictable in tests. */
export function fakeProviderRef(intentId: string): string {
  return `fake_charge_${intentId}`;
}

/** Compute the HMAC signature the fake expects over a raw body. Exported so the test
 * fixture can sign an event with the exact same scheme the server verifies. */
export function signFakeBody(rawBody: Buffer | string, secret = FAKE_WEBHOOK_SECRET): string {
  const body = typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody;
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** Default redirect base for the fake when no override is supplied. Non-resolvable by
 * design — only used in offline tests that never load the page. Real dev runs pass a
 * working URL (see config FAKE_CHECKOUT_REDIRECT_URL). */
export const FAKE_CHECKOUT_BASE = "https://fake-provider.test/checkout";

export function createFakeProvider(
  secret = FAKE_WEBHOOK_SECRET,
  checkoutBase = FAKE_CHECKOUT_BASE,
): PaymentProvider {
  return {
    createCharge(args: CreateChargeArgs): Promise<CreateChargeResult> {
      const providerRef = fakeProviderRef(args.metadata.intentId);
      return Promise.resolve({
        providerRef,
        redirectUrl: `${checkoutBase}/${providerRef}`,
      });
    },

    verifyWebhook(rawBody: Buffer, signatureHeader: string | undefined): boolean {
      if (!signatureHeader) return false;
      const expected = signFakeBody(rawBody, secret);
      const a = Buffer.from(signatureHeader);
      const b = Buffer.from(expected);
      // Length must match before timingSafeEqual (it throws on length mismatch).
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    },

    parseEvent(rawBody: Buffer): ProviderEvent {
      // The fake's wire format IS the ProviderEvent shape (no provider-specific mapping).
      return JSON.parse(rawBody.toString("utf-8")) as ProviderEvent;
    },
  };
}
