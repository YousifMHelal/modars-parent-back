// The PaymentProvider interface — the ONLY payment surface the billing and webhook
// modules depend on (research.md §1, contracts/webhooks.openapi.yaml). A concrete
// adapter (Moyasar) is used when secrets are present; tests/dev use the in-memory
// deterministic fake. Keeping the modules behind this interface makes the provider
// swappable without touching any business logic.

/** The metadata echoed back on the webhook so the family is resolved from the event,
 * never a session (FR-011). Every value is a string (provider metadata is string-keyed). */
export interface ChargeMetadata {
  familyId: string;
  subscriptionId: string;
  intentId: string;
  purpose: "ACTIVATION" | "RENEWAL" | "OVERFLOW" | "UPGRADE";
  [key: string]: string;
}

export interface CreateChargeArgs {
  amountMinor: number;
  currency: string;
  description: string;
  metadata: ChargeMetadata;
  /** Optional saved-method token to charge; omit to use provider-hosted checkout. */
  methodRef?: string;
}

export interface CreateChargeResult {
  providerRef: string;
  redirectUrl?: string;
}

/** The logical event type the server reacts to (mapped from provider fields by the
 * adapter's parseEvent). Mirrors webhooks.openapi.yaml ProviderEvent.type. */
export type ProviderEventType =
  | "payment_succeeded"
  | "payment_failed"
  | "renewal_succeeded"
  | "renewal_failed"
  | "refunded"
  | "disputed";

/** The normalized event the webhook service operates on, parsed AFTER signature
 * verification. `id` is the idempotency dedup key (WebhookEvent.providerEventId). */
export interface ProviderEvent {
  id: string;
  type: ProviderEventType;
  data: {
    providerRef: string;
    amountMinor?: number;
    currency?: string;
    metadata?: Partial<ChargeMetadata>;
  };
}

export interface PaymentProvider {
  /** Create a charge for the server-computed amount; returns a provider ref + redirect. */
  createCharge(args: CreateChargeArgs): Promise<CreateChargeResult>;
  /** Verify the provider signature over the RAW request bytes (crypto-only, no parse). */
  verifyWebhook(rawBody: Buffer, signatureHeader: string | undefined): boolean;
  /** Parse the raw body into a normalized ProviderEvent — only call after verifyWebhook. */
  parseEvent(rawBody: Buffer): ProviderEvent;
}
