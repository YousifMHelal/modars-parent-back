import { z } from "zod";

// Zod boundary contracts for the billing write module (Principle III; mirrors
// contracts/billing.openapi.yaml). The cardinal rule: NO amount is ever accepted from
// the client — every amount is computed server-side (FR-002/016). Raw card/PAN data is
// rejected at the boundary; only provider references are accepted (FR-020/027).

// ── Initiate (US1) ────────────────────────────────────────────────────────────

export const initiateSchema = {
  body: z.object({
    // Optional saved-method token to charge; omit to use provider-hosted checkout.
    methodRef: z.string().min(1).optional(),
  }),
};

export type InitiateInput = z.infer<typeof initiateSchema.body>;

// ── Overflow upgrade (US3) ────────────────────────────────────────────────────

export const overflowUpgradeSchema = {
  body: z.object({
    childDraftId: z.string().min(1),
  }),
};

export type OverflowUpgradeInput = z.infer<typeof overflowUpgradeSchema.body>;

// ── Plan change (US3) ─────────────────────────────────────────────────────────

export const planChangeSchema = {
  body: z.object({
    targetPlan: z.enum(["starter", "family", "family-pro"]),
    billingCycle: z.enum(["MONTHLY", "YEARLY"]).optional(),
  }),
};

export type PlanChangeInput = z.infer<typeof planChangeSchema.body>;

// ── Payment method (US4) ──────────────────────────────────────────────────────
// Only a provider token is accepted. The schema is STRICT so any extra field —
// including raw card data (number/cvv/pan/expiry) — is rejected at the boundary with a
// validation error rather than silently stripped (FR-020/027).

export const paymentMethodSchema = {
  body: z
    .object({
      providerMethodRef: z.string().min(1),
    })
    .strict("Only a provider method token is accepted; raw card data is rejected"),
};

export type PaymentMethodInput = z.infer<typeof paymentMethodSchema.body>;

// ── Invoice id param (US4) ────────────────────────────────────────────────────

export const invoiceParamSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
};
