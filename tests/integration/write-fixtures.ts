import prisma from "../../src/db/prisma.js";
import { hashSecret } from "../../src/lib/hashing.js";
import { signAccess } from "../../src/lib/jwt.js";
import type { PrincipalRole, PrincipalType } from "../../src/lib/jwt.js";
import { PLANS_DATA } from "../../prisma/seed/mock-data.js";
import { signFakeBody, fakeProviderRef } from "../../src/lib/payments/fake.js";
import type { ProviderEvent, ProviderEventType } from "../../src/lib/payments/provider.js";

// Two-family fixture for the Phase 4 write tests.
//   Family A: owner + co-parent + one active child + a PENDING-or-given subscription.
//   Family B: owner + one child (cross-family scoping target).
// Token minters create a real AuthSession so requireAuth.isSessionValid passes.

export interface WriteFixture {
  familyAId: string;
  familyBId: string;
  ownerParentId: string;
  coParentId: string;
  ownerEmail: string;
  childId: string;
  childSessionId: string;
  familyBOwnerId: string;
  familyBChildId: string;
  planKey: "STARTER" | "FAMILY" | "FAMILY_PRO";
  subscriptionId: string;
  familyBSubscriptionId: string;
}

const TEST_FAMILY_NAMES = ["write-test-family-a", "write-test-family-b"];

async function mintAccess(params: {
  principalId: string;
  principalType: PrincipalType;
  role: PrincipalRole;
  familyId: string;
}): Promise<string> {
  const session = await prisma.authSession.create({
    data: {
      familyId: params.familyId,
      principalType: params.principalType === "parent" ? "PARENT" : "CHILD",
      ...(params.principalType === "parent" ? { parentId: params.principalId } : {}),
      ...(params.principalType === "child" ? { childId: params.principalId } : {}),
      refreshTokenHash: `test-${Math.random().toString(36).slice(2)}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  return signAccess({
    sub: params.principalId,
    type: params.principalType,
    role: params.role,
    familyId: params.familyId,
    sid: session.id,
  });
}

export function mintOwnerToken(fx: WriteFixture): Promise<string> {
  return mintAccess({
    principalId: fx.ownerParentId,
    principalType: "parent",
    role: "owner",
    familyId: fx.familyAId,
  });
}

export function mintCoParentToken(fx: WriteFixture): Promise<string> {
  return mintAccess({
    principalId: fx.coParentId,
    principalType: "parent",
    role: "co_parent",
    familyId: fx.familyAId,
  });
}

export function mintChildToken(fx: WriteFixture): Promise<string> {
  return mintAccess({
    principalId: fx.childId,
    principalType: "child",
    role: "child",
    familyId: fx.familyAId,
  });
}

export function mintFamilyBOwnerToken(fx: WriteFixture): Promise<string> {
  return mintAccess({
    principalId: fx.familyBOwnerId,
    principalType: "parent",
    role: "owner",
    familyId: fx.familyBId,
  });
}

async function ensurePlan(planKey: "STARTER" | "FAMILY" | "FAMILY_PRO") {
  const data = PLANS_DATA.find((p) => p.key === planKey)!;
  return prisma.plan.upsert({ where: { key: planKey }, update: {}, create: data });
}

export async function setupWriteFixture(
  planKey: "STARTER" | "FAMILY" | "FAMILY_PRO" = "FAMILY",
): Promise<WriteFixture> {
  const parentPasswordHash = await hashSecret("ParentPass123!");
  const childPasswordHash = await hashSecret("ChildPass123!");
  const uniq = Math.random().toString(36).slice(2, 8);

  const familyA = await prisma.family.create({ data: { name: "write-test-family-a" } });
  const ownerEmail = `write.owner.${uniq}@test.write`;
  const owner = await prisma.parent.create({
    data: {
      familyId: familyA.id,
      role: "OWNER",
      fullName: "Owner Parent",
      email: ownerEmail,
      phoneCountry: "+966",
      phoneNumber: "501234567",
      country: "Saudi Arabia",
      passwordHash: parentPasswordHash,
      dob: new Date("1985-01-01"),
    },
  });
  const coParent = await prisma.parent.create({
    data: {
      familyId: familyA.id,
      role: "CO_PARENT",
      fullName: "Co Parent",
      email: `write.coparent.${uniq}@test.write`,
      passwordHash: parentPasswordHash,
      dob: new Date("1986-01-01"),
    },
  });

  const plan = await ensurePlan(planKey);
  const subscriptionA = await prisma.subscription.create({
    data: {
      familyId: familyA.id,
      planId: plan.id,
      status: "PENDING",
      billingCycle: "MONTHLY",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const childUsername = `write_child_${uniq}`;
  const child = await prisma.child.create({
    data: {
      familyId: familyA.id,
      displayName: "Test Child",
      dob: new Date("2014-05-05"),
      gender: "MALE",
      country: "SA",
      grade: "Grade 5",
      curriculum: "BRITISH",
      subjects: ["Mathematics"],
      username: childUsername,
      usernameNormalized: childUsername,
      passwordHash: childPasswordHash,
    },
  });
  // A live child session so we can assert pause/delete/credential-reset revokes it.
  const childSession = await prisma.authSession.create({
    data: {
      familyId: familyA.id,
      principalType: "CHILD",
      childId: child.id,
      refreshTokenHash: `child-${uniq}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  // ── Family B ──
  const familyB = await prisma.family.create({ data: { name: "write-test-family-b" } });
  const familyBOwner = await prisma.parent.create({
    data: {
      familyId: familyB.id,
      role: "OWNER",
      fullName: "Other Parent",
      email: `write.other.${uniq}@test.write`,
      passwordHash: parentPasswordHash,
      dob: new Date("1985-01-01"),
    },
  });
  const familyBChild = await prisma.child.create({
    data: {
      familyId: familyB.id,
      displayName: "Other Child",
      dob: new Date("2014-05-05"),
      gender: "FEMALE",
      country: "US",
      grade: "Grade 6",
      curriculum: "AMERICAN",
      subjects: ["Mathematics"],
      username: `other_child_${uniq}`,
      usernameNormalized: `other_child_${uniq}`,
      passwordHash: childPasswordHash,
    },
  });
  // Family B subscription + a paid invoice, so cross-family invoice probes (T039/T041)
  // have a real foreign invoice id to be denied (404).
  const subscriptionB = await prisma.subscription.create({
    data: {
      familyId: familyB.id,
      planId: plan.id,
      status: "ACTIVE",
      billingCycle: "MONTHLY",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  return {
    familyAId: familyA.id,
    familyBId: familyB.id,
    ownerParentId: owner.id,
    coParentId: coParent.id,
    ownerEmail,
    childId: child.id,
    childSessionId: childSession.id,
    familyBOwnerId: familyBOwner.id,
    familyBChildId: familyBChild.id,
    planKey,
    subscriptionId: subscriptionA.id,
    familyBSubscriptionId: subscriptionB.id,
  };
}

// ── Phase 5 helpers ───────────────────────────────────────────────────────────

/**
 * A PENDING family with a plan and one child (the Phase 4 starting point for US1). The
 * default setupWriteFixture already produces exactly this — re-exported under the
 * spec's name (T014) so billing tests read intentionally.
 */
export function pendingFamilyWithPlanAndChild(
  planKey: "STARTER" | "FAMILY" | "FAMILY_PRO" = "FAMILY",
): Promise<WriteFixture> {
  return setupWriteFixture(planKey);
}

/**
 * Build a signed fake provider event the webhook will verify (T014). Returns the raw
 * body bytes and the matching X-Provider-Signature so a test can POST both. The
 * provider charge ref is derived from the intent id via fakeProviderRef, so callers
 * pass the intentId (the metadata.intentId) — the same value initiate persisted.
 */
export function signFakeEvent(
  type: ProviderEventType,
  intentId: string,
  overrides: {
    eventId?: string;
    providerRef?: string;
    amountMinor?: number;
    currency?: string;
    metadata?: Partial<ProviderEvent["data"]["metadata"]>;
  } = {},
): { rawBody: Buffer; signature: string; event: ProviderEvent } {
  const providerRef = overrides.providerRef ?? fakeProviderRef(intentId);
  const event: ProviderEvent = {
    id: overrides.eventId ?? `evt_${Math.random().toString(36).slice(2)}`,
    type,
    data: {
      providerRef,
      ...(overrides.amountMinor !== undefined ? { amountMinor: overrides.amountMinor } : {}),
      ...(overrides.currency ? { currency: overrides.currency } : {}),
      metadata: { intentId, ...(overrides.metadata ?? {}) },
    },
  };
  const rawBody = Buffer.from(JSON.stringify(event));
  return { rawBody, signature: signFakeBody(rawBody), event };
}

export async function teardownWriteFixture(): Promise<void> {
  const families = await prisma.family.findMany({
    where: { name: { in: TEST_FAMILY_NAMES } },
    select: { id: true },
  });
  const familyIds = families.map((f) => f.id);
  if (familyIds.length === 0) return;

  await prisma.coParentInvitation.deleteMany({ where: { familyId: { in: familyIds } } });
  // Phase 5: the WebhookEvent ledger is global (no familyId). Clear the test events
  // (providerEventId starts with "evt_") so a fixed dedup key doesn't carry across runs.
  await prisma.webhookEvent.deleteMany({ where: { providerEventId: { startsWith: "evt_" } } });
  // payment intents/methods/invoices reference the subscription/family with
  // onDelete: Restrict — delete them before the subscription and family rows.
  await prisma.paymentIntent.deleteMany({ where: { familyId: { in: familyIds } } });
  await prisma.paymentMethod.deleteMany({ where: { familyId: { in: familyIds } } });
  await prisma.invoice.deleteMany({ where: { subscription: { familyId: { in: familyIds } } } });
  await prisma.subscription.deleteMany({ where: { familyId: { in: familyIds } } });
  await prisma.authSession.updateMany({
    where: { familyId: { in: familyIds } },
    data: { replacedById: null },
  });
  await prisma.authSession.deleteMany({ where: { familyId: { in: familyIds } } });
  await prisma.child.deleteMany({ where: { familyId: { in: familyIds } } });
  await prisma.parent.deleteMany({ where: { familyId: { in: familyIds } } });
  await prisma.family.deleteMany({ where: { id: { in: familyIds } } });
}
