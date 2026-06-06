import pino from "pino";
import type { Reward, RewardStatus } from "../../generated/prisma/client.js";
import prisma from "../../db/prisma.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { assertChildInFamily } from "../../lib/familyScope.js";
import type { NotificationIntent } from "../notifications/notifications.service.js";
import type { CreateRewardInput, EditRewardInput, ListRewardsInput } from "./rewards.schema.js";

const logger = pino({ name: "rewards.service" });

// The only layer touching Prisma for rewards (Principle II). Every read/write is scoped
// `where { familyId }` from the verified principal (Principle I); child-scoped rewards are
// validated via assertChildInFamily. Fulfillment is manual, server-authoritative, and the
// ONLY writer of status FULFILLED (Principle VI / FR-004).

// ── Read shape (derived goal fields, never persisted) ─────────────────────────

export interface RewardView {
  id: string;
  childId: string | null;
  title: string;
  description: string | null;
  status: RewardStatus;
  goalMetric: "XP" | "SESSIONS" | null;
  goalTarget: number | null;
  goalProgress: number | null;
  claimable: boolean;
  goalMet: boolean;
  fulfilledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Pure claimable/goal-met computation (research.md §1/§3) — extracted so it is unit
 * testable without Prisma. A reward is claimable when its goal target is met while the
 * reward is still ACTIVE; a null metric/target/progress is never claimable. Reaching the
 * goal never changes `status` (FR-006).
 */
export function computeGoalMet(
  status: RewardStatus,
  goalTarget: number | null,
  goalProgress: number | null,
): boolean {
  return (
    status === "ACTIVE" &&
    goalTarget != null &&
    goalProgress != null &&
    goalProgress >= goalTarget
  );
}

/**
 * Derive a reward's goal progress from the child's live, server-derived state
 * (research.md §1): XP → child.totalXp; SESSIONS → count of completed sessions. A reward
 * with no goal has null progress and is not claimable. `claimable`/`goalMet` are true when
 * the goal is met while the reward is still ACTIVE — they never change `status` (FR-006).
 */
export async function deriveGoal(reward: Reward): Promise<RewardView> {
  let goalProgress: number | null = null;

  if (reward.goalMetric && reward.childId) {
    if (reward.goalMetric === "XP") {
      const child = await prisma.child.findFirst({
        where: { id: reward.childId, familyId: reward.familyId },
        select: { totalXp: true },
      });
      goalProgress = child?.totalXp ?? 0;
    } else {
      // SESSIONS → count of the child's completed (scored) sessions.
      goalProgress = await prisma.session.count({
        where: { childId: reward.childId, familyId: reward.familyId, score: { not: null } },
      });
    }
  }

  const goalMet = computeGoalMet(reward.status, reward.goalTarget, goalProgress);

  return {
    id: reward.id,
    childId: reward.childId,
    title: reward.title,
    description: reward.description,
    status: reward.status,
    goalMetric: reward.goalMetric,
    goalTarget: reward.goalTarget,
    goalProgress,
    claimable: goalMet,
    goalMet,
    fulfilledAt: reward.fulfilledAt,
    createdAt: reward.createdAt,
    updatedAt: reward.updatedAt,
  };
}

// ── Create (FR-001/005) ───────────────────────────────────────────────────────

export async function createReward(
  familyId: string,
  input: CreateRewardInput,
): Promise<RewardView> {
  // A child-scoped reward must reference an in-family child (404 otherwise).
  if (input.childId) {
    await assertChildInFamily(familyId, input.childId);
  }

  const reward = await prisma.reward.create({
    data: {
      family: { connect: { id: familyId } },
      ...(input.childId ? { child: { connect: { id: input.childId } } } : {}),
      title: input.title,
      description: input.description ?? null,
      goalMetric: input.goalMetric ?? null,
      goalTarget: input.goalTarget ?? null,
      status: "ACTIVE",
    },
  });
  logger.info({ rewardId: reward.id, familyId, childId: reward.childId }, "reward created");
  return deriveGoal(reward);
}

// ── List / get (FR-016 — family-scoped) ───────────────────────────────────────

export async function listRewards(
  familyId: string,
  filters: ListRewardsInput,
): Promise<RewardView[]> {
  const rewards = await prisma.reward.findMany({
    where: {
      familyId,
      ...(filters.childId ? { childId: filters.childId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(rewards.map((r) => deriveGoal(r)));
}

async function loadReward(familyId: string, rewardId: string): Promise<Reward> {
  const reward = await prisma.reward.findFirst({ where: { id: rewardId, familyId } });
  if (!reward) {
    // Foreign / missing are indistinguishable (Principle I).
    throw new NotFoundError("Reward not found");
  }
  return reward;
}

export async function getReward(familyId: string, rewardId: string): Promise<RewardView> {
  return deriveGoal(await loadReward(familyId, rewardId));
}

// ── Edit (terms of an already-fulfilled reward are immutable → 409) ────────────

export async function editReward(
  familyId: string,
  rewardId: string,
  input: EditRewardInput,
): Promise<RewardView> {
  const existing = await loadReward(familyId, rewardId);
  if (existing.status === "FULFILLED") {
    throw new ConflictError("A fulfilled reward's terms can no longer be edited");
  }

  if (input.childId) {
    await assertChildInFamily(familyId, input.childId);
  }

  const reward = await prisma.reward.update({
    where: { id: rewardId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.childId !== undefined ? { childId: input.childId } : {}),
      ...(input.goalMetric !== undefined ? { goalMetric: input.goalMetric } : {}),
      ...(input.goalTarget !== undefined ? { goalTarget: input.goalTarget } : {}),
    },
  });
  logger.info({ rewardId, familyId }, "reward edited");
  return deriveGoal(reward);
}

// ── Goal-met notification intents (US2 / research.md §4) ──────────────────────

/**
 * Build notification intents for a child's reward goals that are currently met while the
 * reward is still ACTIVE. Called from the Phase 6 derivation path AFTER progress is
 * recomputed; the central dispatcher enforces the per-child daily cap and its unique
 * (childId, capDay, type) guard makes a repeated met-state a no-op (no new dispatch, no
 * status change — Principle V/VI, FR-006). Returns intents only; it never delivers and
 * never writes `status: FULFILLED`.
 */
export async function goalMetIntentsForChild(
  familyId: string,
  childId: string,
  now: Date = new Date(),
): Promise<NotificationIntent[]> {
  const rewards = await prisma.reward.findMany({
    where: { familyId, childId, status: "ACTIVE", goalMetric: { not: null }, goalTarget: { not: null } },
  });

  const intents: NotificationIntent[] = [];
  for (const reward of rewards) {
    const view = await deriveGoal(reward);
    if (!view.goalMet) continue;
    intents.push({
      familyId,
      childId,
      recipient: "PARENT",
      type: "REWARD_REDEEMED",
      source: "REMINDER",
      channels: ["PUSH", "EMAIL"],
      title: "Reward goal reached",
      body: `"${reward.title}" is now claimable`,
      triggerTime: now,
      // Counts against the child's central daily cap (research §4); the dispatcher's
      // unique (childId, capDay, type) guard makes a repeated met-state a no-op.
      countsAgainstCap: true,
    });
  }
  return intents;
}

// ── Manual fulfill (FR-003/004/007 — idempotent, conditional update) ───────────

/**
 * Manually mark a reward fulfilled. A conditional update on
 * `where { id, familyId, status: ACTIVE }` makes this atomic and idempotent: a repeat or
 * concurrent call matches zero rows and returns the current reward unchanged (research §2).
 * This is the ONLY code path that may set status FULFILLED — no job/event/goal branch does.
 */
export async function fulfillReward(familyId: string, rewardId: string): Promise<RewardView> {
  // 404 for a foreign/missing reward before any write (Principle I).
  await loadReward(familyId, rewardId);

  const result = await prisma.reward.updateMany({
    where: { id: rewardId, familyId, status: "ACTIVE" },
    data: { status: "FULFILLED", fulfilledAt: new Date() },
  });

  if (result.count > 0) {
    logger.info({ rewardId, familyId }, "reward fulfilled");
  } else {
    // Zero match → already fulfilled (or expired): a safe no-op, return current state.
    logger.info({ rewardId, familyId }, "reward fulfill no-op (already settled)");
  }

  return deriveGoal(await loadReward(familyId, rewardId));
}
