import prisma from "../../db/prisma.js";
import { AppError, ErrorCode } from "../../lib/errors.js";
import { recordConsent } from "../../lib/consent.js";
import { registerParent, type TokenPair } from "../auth/auth.service.js";
import { PLAN_KEY_MAP, type RegisterInput, type PlanSelectionInput } from "./onboarding.schema.js";

// Onboarding is progressive writes onto the real models (research.md §2): no draft
// table. This service is the sole Prisma toucher for onboarding; price/state are
// derived server-side and the subscription stays PENDING until Phase 5.

// The consent policy versions accepted at registration. Bump when terms change; re-consent
// appends a new record (lib/consent is append-only — FR-006).
const CONSENT_VERSION = "1.0";

// ── Step 1: register (reuses auth.registerParent) ─────────────────────────────

export async function registerOnboarding(input: RegisterInput): Promise<TokenPair> {
  const tokens = await registerParent({
    familyName: `${input.fullName}'s Family`,
    fullName: input.fullName,
    email: input.email,
    password: input.password,
    dob: new Date(input.dateOfBirth),
    ...(input.country !== undefined ? { country: input.country } : {}),
  });

  // Capture the parent-level TERMS/PRIVACY/COPPA consent accepted at signup (FR-005,
  // research.md §5) — closes the "ConsentRecord never written" gap. Append-only via
  // lib/consent. Best-effort: a consent write must not fail an otherwise-valid signup,
  // and a re-register with the same email is impossible (auth rejects duplicates).
  const parent = await prisma.parent.findUnique({
    where: { email: input.email },
    select: { id: true, familyId: true },
  });
  if (parent) {
    for (const type of ["TERMS", "PRIVACY", "COPPA"] as const) {
      await recordConsent(prisma, {
        familyId: parent.familyId,
        parentId: parent.id,
        type,
        version: CONSENT_VERSION,
      });
    }
  }

  return tokens;
}

// ── Step 2: plan selection → PENDING subscription ─────────────────────────────

export async function selectPlan(familyId: string, input: PlanSelectionInput): Promise<void> {
  const planKey = PLAN_KEY_MAP[input.plan];
  const plan = await prisma.plan.findUnique({ where: { key: planKey } });
  if (!plan) {
    throw new AppError(422, ErrorCode.VALIDATION_ERROR, "Unknown plan");
  }

  // Placeholder period end; Phase 5 sets the real period on activation. Status is
  // forced PENDING — the client can never activate a subscription (Principle VI).
  const currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await prisma.subscription.upsert({
    where: { familyId },
    create: {
      familyId,
      planId: plan.id,
      status: "PENDING",
      billingCycle: input.billingCycle,
      currentPeriodEnd,
    },
    update: {
      planId: plan.id,
      status: "PENDING",
      billingCycle: input.billingCycle,
    },
  });
}

// ── Resume: derive the next incomplete step (research.md §2) ───────────────────

export interface OnboardingState {
  nextStep: number;
  parentExists: boolean;
  planChosen: boolean;
  childrenCount: number;
  subscriptionStatus: string | null;
}

/**
 * Pure resume resolver — maps existing-row facts to the next incomplete wizard step.
 * Parent always exists (the endpoint is behind requireAuth):
 *   parent only → 2 (plan); pending sub w/ plan → 3 (first child); ≥1 child → 4 (payment).
 * Extracted as a pure function so it is unit-testable without Prisma (T012).
 */
export function resolveNextStep(facts: { planChosen: boolean; childrenCount: number }): number {
  if (facts.childrenCount >= 1) return 4;
  if (facts.planChosen) return 3;
  return 2;
}

export async function getOnboardingState(familyId: string): Promise<OnboardingState> {
  const [subscription, childrenCount] = await Promise.all([
    prisma.subscription.findFirst({ where: { familyId, deletedAt: null } }),
    prisma.child.count({ where: { familyId, deletedAt: null } }),
  ]);

  const planChosen = subscription !== null;

  return {
    nextStep: resolveNextStep({ planChosen, childrenCount }),
    parentExists: true,
    planChosen,
    childrenCount,
    subscriptionStatus: subscription?.status ?? null,
  };
}
