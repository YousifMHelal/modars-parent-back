import { z } from "zod";

// Zod schema for the normalized provider event (contracts/webhooks.openapi.yaml). It
// is applied AFTER raw-body signature verification — never as the authentication step.
// The adapter's parseEvent already maps provider fields to this shape; this schema is
// the type-safe boundary before any state change (Principle III).

export const providerEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "payment_succeeded",
    "payment_failed",
    "renewal_succeeded",
    "renewal_failed",
    "refunded",
    "disputed",
  ]),
  data: z.object({
    providerRef: z.string(),
    amountMinor: z.number().int().optional(),
    currency: z.string().optional(),
    metadata: z
      .object({
        familyId: z.string().optional(),
        subscriptionId: z.string().optional(),
        intentId: z.string().optional(),
        purpose: z.enum(["ACTIVATION", "RENEWAL", "OVERFLOW", "UPGRADE"]).optional(),
      })
      .passthrough()
      .optional(),
  }),
});

export type ProviderEventParsed = z.infer<typeof providerEventSchema>;
