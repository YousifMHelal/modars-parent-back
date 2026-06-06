import { z } from "zod";

// Zod boundary contracts for the onboarding write module (Principle III).
// Mirrors contracts/onboarding.openapi.yaml + the FE ParentDetailsStep/PlanSelectionStep.

export const registerSchema = {
  body: z.object({
    fullName: z.string().min(1).max(200),
    email: z.string().email(),
    password: z.string().min(6).max(128),
    dateOfBirth: z.string().date(),
    phoneCountry: z.string().max(10).optional(),
    phoneNumber: z.string().max(40).optional(),
    country: z.string().min(2).max(100).optional(),
  }),
};

export type RegisterInput = z.infer<typeof registerSchema.body>;

// FE plan keys (starter|family|family-pro) → Prisma PlanKey (STARTER|FAMILY|FAMILY_PRO).
export const PLAN_KEY_MAP = {
  starter: "STARTER",
  family: "FAMILY",
  "family-pro": "FAMILY_PRO",
} as const;

export const planSelectionSchema = {
  body: z.object({
    plan: z.enum(["starter", "family", "family-pro"]),
    billingCycle: z.enum(["MONTHLY", "YEARLY"]),
  }),
};

export type PlanSelectionInput = z.infer<typeof planSelectionSchema.body>;
