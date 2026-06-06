import { z } from "zod";

// Zod boundary contracts for the rewards module (Principle III), mirroring
// contracts/rewards.openapi.yaml. `additionalProperties: false` via `.strict()` so a
// client-supplied `goalCurrent` (or any unknown field) is rejected (FR-005). When a goal
// is set, both `goalTarget > 0` and a `childId` are required (data-model.md).

const goalMetricEnum = z.enum(["XP", "SESSIONS"]);
const titleField = z.string().trim().min(1).max(120);
const descriptionField = z.string().max(1000).nullable();
const goalTargetField = z.number().int().positive();

export const rewardIdParamSchema = z.object({
  rewardId: z.string().min(1),
});

// A goal is coherent only when metric + target + a child are all present together.
function requireGoalCoherence(
  d: {
    goalMetric?: "XP" | "SESSIONS" | null | undefined;
    goalTarget?: number | null | undefined;
    childId?: string | null | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (d.goalMetric) {
    if (d.goalTarget == null || d.goalTarget <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["goalTarget"],
        message: "goalTarget > 0 is required when goalMetric is set",
      });
    }
    if (!d.childId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["childId"],
        message: "childId is required when goalMetric is set",
      });
    }
  }
}

// ── Create ──────────────────────────────────────────────────────────────────

export const createRewardSchema = {
  body: z
    .object({
      title: titleField,
      description: descriptionField.optional(),
      childId: z.string().min(1).nullable().optional(),
      goalMetric: goalMetricEnum.nullable().optional(),
      goalTarget: goalTargetField.nullable().optional(),
    })
    .strict()
    .superRefine(requireGoalCoherence),
};

export type CreateRewardInput = z.infer<typeof createRewardSchema.body>;

// ── Edit (rejected at the service if the reward is already fulfilled → 409) ────

export const editRewardSchema = {
  params: rewardIdParamSchema,
  body: z
    .object({
      title: titleField.optional(),
      description: descriptionField.optional(),
      childId: z.string().min(1).nullable().optional(),
      goalMetric: goalMetricEnum.nullable().optional(),
      goalTarget: goalTargetField.nullable().optional(),
    })
    .strict()
    .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" })
    .superRefine(requireGoalCoherence),
};

export type EditRewardInput = z.infer<typeof editRewardSchema.body>;

// ── List (query filters) ──────────────────────────────────────────────────────

export const listRewardsSchema = {
  query: z
    .object({
      childId: z.string().min(1).optional(),
      status: z.enum(["ACTIVE", "FULFILLED", "EXPIRED"]).optional(),
    })
    .strict(),
};

export type ListRewardsInput = z.infer<typeof listRewardsSchema.query>;

// ── Fulfill / get (param-only) ────────────────────────────────────────────────

export const rewardActionSchema = {
  params: rewardIdParamSchema,
};
