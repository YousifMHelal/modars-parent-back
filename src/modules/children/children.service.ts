import { Prisma, type Child } from "../../generated/prisma/client.js";
import pino from "pino";
import prisma from "../../db/prisma.js";
import { hashSecret } from "../../lib/hashing.js";
import {
  ConflictError,
  PlanLimitReachedError,
  RestoreWindowExpiredError,
  NotFoundError,
} from "../../lib/errors.js";
import { assertChildInFamily } from "../../lib/familyScope.js";
import { normalizeUsername, suggestUsername, alternatives, isValidUsername } from "../../lib/username.js";
import { updateChildCredentials, revokeAllForChild } from "../auth/auth.service.js";
import { renderLoginCard } from "../../lib/loginCard.js";
import storage from "../../lib/storage.js";
import type { CreateChildInput, EditChildInput, CredentialsInput } from "./children.schema.js";

const logger = pino({ name: "children.service" });

const RESTORE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// ── Plan-limit helpers (FR-012, research.md §7) ───────────────────────────────

async function planChildLimit(familyId: string): Promise<number> {
  const subscription = await prisma.subscription.findFirst({
    where: { familyId, deletedAt: null },
    include: { plan: true },
  });
  // No subscription yet (mid-onboarding before plan selection) → starter-equivalent
  // single slot, so the first child can always be created (US1 step 3 before payment).
  return subscription?.plan?.childLimit ?? 1;
}

async function activeChildCount(familyId: string): Promise<number> {
  return prisma.child.count({ where: { familyId, deletedAt: null } });
}

async function assertSlotAvailable(familyId: string): Promise<void> {
  const { limit, used } = await getSlotUsage(familyId);
  if (used >= limit) {
    throw new PlanLimitReachedError("You've reached your plan's child limit");
  }
}

/**
 * The family's plan child limit and current active-child count. Exported so the
 * Phase 5 billing/overflow path can confirm the family is at its slot limit before
 * offering the prorated overflow upgrade (research.md §6, FR-013).
 */
export async function getSlotUsage(
  familyId: string,
): Promise<{ limit: number; used: number; atLimit: boolean }> {
  const [limit, used] = await Promise.all([planChildLimit(familyId), activeChildCount(familyId)]);
  return { limit, used, atLimit: used >= limit };
}

// ── Login card (best-effort, post-commit — FR-011) ────────────────────────────

async function backfillLoginCard(child: Child): Promise<void> {
  try {
    const { bytes, contentType } = renderLoginCard({
      displayName: child.displayName,
      username: child.username,
      credentialKind: child.pinHash ? "pin" : "password",
    });
    const url = await storage.put(`login-cards/${child.id}.png`, bytes, contentType);
    await prisma.child.update({ where: { id: child.id }, data: { loginCardUrl: url } });
  } catch (err) {
    // Non-blocking: the child create already succeeded; leave loginCardUrl null.
    logger.warn({ err, childId: child.id }, "login-card generation failed (non-fatal)");
  }
}

// ── Create (FR-007…012) ───────────────────────────────────────────────────────

export async function createChild(familyId: string, input: CreateChildInput): Promise<Child> {
  await assertSlotAvailable(familyId);

  const usernameNormalized = normalizeUsername(input.username);
  const data: Prisma.ChildCreateInput = {
    family: { connect: { id: familyId } },
    displayName: input.displayName,
    dob: new Date(input.dateOfBirth),
    gender: input.gender,
    country: input.country,
    grade: input.grade,
    curriculum: input.curriculum,
    subjects: input.subjects,
    username: input.username,
    usernameNormalized,
    ...(input.password !== undefined ? { passwordHash: await hashSecret(input.password) } : {}),
    ...(input.pin !== undefined ? { pinHash: await hashSecret(input.pin) } : {}),
  };

  let child: Child;
  try {
    child = await prisma.child.create({ data });
  } catch (err) {
    // Unique index on usernameNormalized is the authoritative race-safe check (FR-010).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError("Username already taken");
    }
    throw err;
  }

  await backfillLoginCard(child);

  // Return the freshest row (with loginCardUrl if backfill succeeded).
  return (await prisma.child.findUnique({ where: { id: child.id } })) ?? child;
}

// ── Username availability (advisory — FR-008/009/010) ─────────────────────────

export async function checkUsername(
  rawUsername: string,
): Promise<{ available: boolean; suggestions: string[] }> {
  const normalized = normalizeUsername(rawUsername);

  const isTaken = async (candidate: string): Promise<boolean> => {
    const existing = await prisma.child.findUnique({
      where: { usernameNormalized: candidate },
      select: { id: true },
    });
    return existing !== null;
  };

  const taken = await isTaken(normalized);
  const validFormat = isValidUsername(rawUsername);

  if (!taken && validFormat) {
    return { available: true, suggestions: [] };
  }

  // Build alternatives off the requested name (or a safe base if it's malformed).
  const base = validFormat ? rawUsername : suggestUsername(rawUsername);
  const suggestions = await alternatives(base, isTaken, 3);
  return { available: false, suggestions };
}

// ── Edit profile / controls (FR-013, FR-019) ──────────────────────────────────

export async function editChild(
  familyId: string,
  childId: string,
  input: EditChildInput,
): Promise<Child> {
  await assertChildInFamily(familyId, childId);

  const data: Prisma.ChildUpdateInput = {
    ...(input.grade !== undefined ? { grade: input.grade } : {}),
    ...(input.curriculum !== undefined ? { curriculum: input.curriculum } : {}),
    ...(input.subjects !== undefined ? { subjects: input.subjects } : {}),
    ...(input.bedtimeCutoff !== undefined ? { bedtimeCutoff: input.bedtimeCutoff } : {}),
    ...(input.allowedDays !== undefined ? { allowedDays: input.allowedDays } : {}),
    ...(input.blockedSubjects !== undefined ? { blockedSubjects: input.blockedSubjects } : {}),
  };

  return prisma.child.update({ where: { id: childId }, data });
}

// ── Credentials (FR-014; reuses auth.updateChildCredentials) ──────────────────

export async function updateCredentials(
  familyId: string,
  childId: string,
  input: CredentialsInput,
): Promise<void> {
  // assertChildInFamily rejects foreign/missing/soft-deleted before any write.
  await assertChildInFamily(familyId, childId);
  await updateChildCredentials(familyId, childId, {
    ...(input.username !== undefined ? { username: input.username } : {}),
    ...(input.password !== undefined ? { password: input.password } : {}),
    ...(input.pin !== undefined ? { pin: input.pin } : {}),
  });
}

// ── Pause / reactivate (FR-015) ───────────────────────────────────────────────

export async function pauseChild(familyId: string, childId: string): Promise<Child> {
  await assertChildInFamily(familyId, childId);
  const [child] = await prisma.$transaction([
    prisma.child.update({ where: { id: childId }, data: { status: "PAUSED" } }),
    prisma.authSession.updateMany({
      where: { childId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  return child;
}

export async function reactivateChild(familyId: string, childId: string): Promise<Child> {
  await assertChildInFamily(familyId, childId);
  return prisma.child.update({ where: { id: childId }, data: { status: "ACTIVE" } });
}

// ── Soft-delete (FR-016/018) ──────────────────────────────────────────────────

export async function softDeleteChild(familyId: string, childId: string): Promise<void> {
  await assertChildInFamily(familyId, childId);
  await prisma.$transaction([
    prisma.child.update({ where: { id: childId }, data: { deletedAt: new Date() } }),
    prisma.authSession.updateMany({
      where: { childId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  await revokeAllForChild(childId); // idempotent belt-and-braces
}

// ── Restore (FR-017; 7-day window + plan re-check, research.md §7) ─────────────

export async function restoreChild(familyId: string, childId: string): Promise<Child> {
  // assertChildInFamily requires deletedAt: null, so look the soft-deleted row up directly.
  const child = await prisma.child.findFirst({ where: { id: childId, familyId } });
  if (!child || child.deletedAt === null) {
    throw new NotFoundError("Child not found");
  }

  const elapsed = Date.now() - child.deletedAt.getTime();
  if (elapsed > RESTORE_WINDOW_MS) {
    throw new RestoreWindowExpiredError("This child can no longer be restored");
  }

  await assertSlotAvailable(familyId);

  return prisma.child.update({ where: { id: childId }, data: { deletedAt: null } });
}
