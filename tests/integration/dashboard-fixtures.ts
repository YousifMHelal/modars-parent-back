import prisma from "../../src/db/prisma.js";
import { hashSecret } from "../../src/lib/hashing.js";
import { signAccess } from "../../src/lib/jwt.js";
import type { PrincipalRole, PrincipalType } from "../../src/lib/jwt.js";
import {
  AHMED_DATA,
  AHMED_SUBJECT_PROGRESS,
  AHMED_BADGES,
  LAYLA_DATA,
  LAYLA_SUBJECT_PROGRESS,
  LAYLA_BADGES,
  PLANS_DATA,
  SUBSCRIPTION_DATA,
  PARENT_DATA,
  REMINDER_CONFIGS,
  ahmedSessions,
  laylaSessions,
  ahmedHomework,
  laylaHomework,
  notificationsData,
} from "../../prisma/seed/mock-data.js";

// Seeded two-family setup for the dashboard read tests (T011).
//   Family A: Sarah Ahmed (owner) + a co-parent + Ahmed/Layla with full mock data.
//   Family B: another family with one child (cross-family scoping target).
// Token minters create a real AuthSession so requireAuth's isSessionValid passes,
// mirroring tests/integration/auth.permissions.test.ts.

export interface DashboardFixture {
  familyAId: string;
  familyBId: string;
  ownerParentId: string;
  coParentId: string;
  ahmedId: string;
  laylaId: string;
  familyBChildId: string;
}

const TEST_FAMILY_NAMES = ["dash-test-family-a", "dash-test-family-b"];

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

export async function mintParentToken(
  fixture: Pick<DashboardFixture, "familyAId" | "ownerParentId">,
): Promise<string> {
  return mintAccess({
    principalId: fixture.ownerParentId,
    principalType: "parent",
    role: "owner",
    familyId: fixture.familyAId,
  });
}

export async function mintCoParentToken(
  fixture: Pick<DashboardFixture, "familyAId" | "coParentId">,
): Promise<string> {
  return mintAccess({
    principalId: fixture.coParentId,
    principalType: "parent",
    role: "co_parent",
    familyId: fixture.familyAId,
  });
}

export async function mintChildToken(
  fixture: Pick<DashboardFixture, "familyAId" | "ahmedId">,
): Promise<string> {
  return mintAccess({
    principalId: fixture.ahmedId,
    principalType: "child",
    role: "child",
    familyId: fixture.familyAId,
  });
}

async function seedChildWithData(
  familyId: string,
  base: typeof AHMED_DATA,
  subjectProgress: typeof AHMED_SUBJECT_PROGRESS,
  sessions: ReturnType<typeof ahmedSessions>,
  homework: ReturnType<typeof ahmedHomework>,
  badges: typeof AHMED_BADGES,
): Promise<string> {
  const passwordHash = await hashSecret("ChildPass123!");
  // usernameNormalized is globally unique; namespace the fixture's username so it
  // never collides with the real `prisma db seed` data (ahmed.modrs / layla.modrs).
  const fixtureUsername = `${base.username}.dashtest`;
  const child = await prisma.child.create({
    data: {
      familyId,
      ...base,
      username: fixtureUsername,
      usernameNormalized: fixtureUsername,
      passwordHash,
    },
  });

  for (const sp of subjectProgress) {
    await prisma.subjectProgress.create({
      data: {
        familyId,
        childId: child.id,
        subject: sp.subject,
        mastery: sp.mastery,
        coverage: sp.coverage,
        trend: sp.trend,
        lastStudiedAt: sp.lastStudiedAt,
        masteryHistory: sp.masteryHistory,
        topics: { create: sp.topics },
      },
    });
  }

  await prisma.session.createMany({
    data: sessions.map((s) => ({ familyId, childId: child.id, ...s })),
  });

  await prisma.homework.createMany({
    data: homework.map((h) => ({ familyId, childId: child.id, ...h })),
  });

  await prisma.badge.createMany({
    data: badges.map((b) => ({ familyId, childId: child.id, ...b })),
  });

  for (const rc of REMINDER_CONFIGS) {
    await prisma.reminderConfig.create({
      data: {
        familyId,
        childId: child.id,
        type: rc.type,
        enabled: rc.enabled,
        recipient: rc.recipient,
        settings: rc.settings ?? undefined,
      },
    });
  }

  return child.id;
}

export async function setupDashboardFixture(): Promise<DashboardFixture> {
  const parentPasswordHash = await hashSecret("ParentPass123!");

  // ── Family A ──
  const familyA = await prisma.family.create({ data: { name: "dash-test-family-a" } });

  const owner = await prisma.parent.create({
    data: {
      familyId: familyA.id,
      role: "OWNER",
      fullName: PARENT_DATA.fullName,
      email: "dash.owner@test.dash",
      phoneCountry: PARENT_DATA.phoneCountry,
      phoneNumber: PARENT_DATA.phoneNumber,
      country: PARENT_DATA.country,
      passwordHash: parentPasswordHash,
      dob: new Date("1985-01-01"),
    },
  });

  const coParent = await prisma.parent.create({
    data: {
      familyId: familyA.id,
      role: "CO_PARENT",
      fullName: "Co Parent",
      email: "dash.coparent@test.dash",
      passwordHash: parentPasswordHash,
      dob: new Date("1986-01-01"),
    },
  });

  const ahmedId = await seedChildWithData(
    familyA.id,
    AHMED_DATA,
    AHMED_SUBJECT_PROGRESS,
    ahmedSessions(),
    ahmedHomework(),
    AHMED_BADGES,
  );

  const laylaId = await seedChildWithData(
    familyA.id,
    LAYLA_DATA,
    LAYLA_SUBJECT_PROGRESS,
    laylaSessions(),
    laylaHomework(),
    LAYLA_BADGES,
  );

  await prisma.notification.createMany({
    data: notificationsData().map((n) => ({ familyId: familyA.id, ...n })),
  });

  // Subscription on the Family plan (childLimit 4) for the settings test.
  const familyPlanData = PLANS_DATA.find((p) => p.key === "FAMILY")!;
  const familyPlan = await prisma.plan.upsert({
    where: { key: "FAMILY" },
    update: {},
    create: familyPlanData,
  });
  await prisma.subscription.create({
    data: {
      familyId: familyA.id,
      planId: familyPlan.id,
      status: SUBSCRIPTION_DATA.status,
      billingCycle: SUBSCRIPTION_DATA.billingCycle,
      childSlotsUsed: SUBSCRIPTION_DATA.childSlotsUsed,
      currentPeriodEnd: SUBSCRIPTION_DATA.currentPeriodEnd,
    },
  });

  // ── Family B (cross-family scoping) ──
  const familyB = await prisma.family.create({ data: { name: "dash-test-family-b" } });
  await prisma.parent.create({
    data: {
      familyId: familyB.id,
      role: "OWNER",
      fullName: "Other Parent",
      email: "dash.other@test.dash",
      passwordHash: parentPasswordHash,
      dob: new Date("1985-01-01"),
    },
  });
  const childPassHash = await hashSecret("ChildPass123!");
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
      username: "other.child",
      usernameNormalized: "other.child",
      passwordHash: childPassHash,
    },
  });

  return {
    familyAId: familyA.id,
    familyBId: familyB.id,
    ownerParentId: owner.id,
    coParentId: coParent.id,
    ahmedId,
    laylaId,
    familyBChildId: familyBChild.id,
  };
}

/** Removes all rows created by setupDashboardFixture (FK-safe order). */
export async function teardownDashboardFixture(): Promise<void> {
  const families = await prisma.family.findMany({
    where: { name: { in: TEST_FAMILY_NAMES } },
    select: { id: true },
  });
  const familyIds = families.map((f) => f.id);
  if (familyIds.length === 0) return;

  await prisma.topicProgress.deleteMany({
    where: { subjectProgress: { familyId: { in: familyIds } } },
  });
  await prisma.subjectProgress.deleteMany({ where: { familyId: { in: familyIds } } });
  await prisma.session.deleteMany({ where: { familyId: { in: familyIds } } });
  await prisma.homework.deleteMany({ where: { familyId: { in: familyIds } } });
  await prisma.badge.deleteMany({ where: { familyId: { in: familyIds } } });
  await prisma.reminderConfig.deleteMany({ where: { familyId: { in: familyIds } } });
  await prisma.notification.deleteMany({ where: { familyId: { in: familyIds } } });
  await prisma.invoice.deleteMany({
    where: { subscription: { familyId: { in: familyIds } } },
  });
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
