import { describe, it, expect, beforeEach, afterEach } from "vitest";
import prisma from "../../src/db/prisma.js";
import { createChild } from "../../src/modules/children/children.service.js";
import {
  requestAccountDeletion,
  cancelAccountDeletion,
  purgeDueDeletedFamilies,
  computePurgeAfter,
} from "../../src/modules/settings/settings.service.js";

// Family-purge ordering + idempotency (US1, FR-008/011–014, research.md §2). A family past
// its retain window is hard-deleted in FK-safe order (child dependents → children → family
// rows → parents → family); a re-run is a clean no-op; a restored family is excluded.

let familyId: string;
let planId: string;

const childInput = (username: string) => ({
  displayName: "Purge Child",
  dateOfBirth: "2014-01-01",
  gender: "MALE" as const,
  country: "SA",
  grade: "Grade 5",
  curriculum: "BRITISH" as const,
  subjects: ["Mathematics"],
  username,
  password: "ChildPass123!",
});

beforeEach(async () => {
  const family = await prisma.family.create({ data: { name: "familypurge-unit-family" } });
  familyId = family.id;
  await prisma.parent.create({
    data: {
      familyId,
      role: "OWNER",
      fullName: "Owner",
      email: `fp.owner.${Math.random().toString(36).slice(2)}@test.fp`,
      dob: new Date("1985-01-01"),
    },
  });
  const plan = await prisma.plan.upsert({
    where: { key: "FAMILY_PRO" },
    update: {},
    create: {
      key: "FAMILY_PRO",
      name: "Family Pro",
      subtitle: "test",
      childLimit: 10,
      monthlyPriceMinor: 1000,
      yearlyPriceMinor: 10000,
      yearlyDiscountMinor: 0,
      currency: "SAR",
      features: [],
    },
  });
  planId = plan.id;
  await prisma.subscription.create({
    data: {
      familyId,
      planId,
      status: "ACTIVE",
      billingCycle: "MONTHLY",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
});

afterEach(async () => {
  // Best-effort cleanup in case a test left the family un-purged.
  const sub = await prisma.subscription.findUnique({ where: { familyId } });
  if (sub) await prisma.invoice.deleteMany({ where: { subscriptionId: sub.id } });
  await prisma.subscription.deleteMany({ where: { familyId } });
  await prisma.child.deleteMany({ where: { familyId } });
  await prisma.consentRecord.deleteMany({ where: { familyId } });
  await prisma.authSession.deleteMany({ where: { familyId } });
  await prisma.parent.deleteMany({ where: { familyId } });
  await prisma.family.deleteMany({ where: { id: familyId } });
});

const afterWindow = (): Date => new Date(computePurgeAfter(new Date()).getTime() + 1000);

describe("purgeDueDeletedFamilies", () => {
  it("does not purge a family still inside its retain window", async () => {
    await requestAccountDeletion(familyId);
    const purged = await purgeDueDeletedFamilies(new Date());
    expect(purged).not.toContain(familyId);
    expect(await prisma.family.findUnique({ where: { id: familyId } })).not.toBeNull();
  });

  it("hard-deletes the whole family graph past the window and releases usernames", async () => {
    const uniq = Math.random().toString(36).slice(2, 8);
    const child = await createChild(familyId, childInput(`fp_a_${uniq}`));
    await prisma.session.create({
      data: {
        familyId,
        childId: child.id,
        subject: "Mathematics",
        startedAt: new Date(),
        durationMinutes: 20,
        topics: [],
      },
    });
    await requestAccountDeletion(familyId);

    const purged = await purgeDueDeletedFamilies(afterWindow());
    expect(purged).toContain(familyId);
    expect(await prisma.family.findUnique({ where: { id: familyId } })).toBeNull();
    expect(await prisma.child.findUnique({ where: { id: child.id } })).toBeNull();
    // Username freed for reuse in a fresh family.
    const other = await prisma.family.create({ data: { name: "fp-reuse" } });
    const recreated = await createChild(other.id, childInput(`fp_a_${uniq}`));
    expect(recreated.usernameNormalized).toBe(`fp_a_${uniq}`);
    await prisma.child.deleteMany({ where: { familyId: other.id } });
    await prisma.family.delete({ where: { id: other.id } });
  });

  it("excludes a family restored (cancel) before the run", async () => {
    await requestAccountDeletion(familyId);
    await cancelAccountDeletion(familyId);
    const purged = await purgeDueDeletedFamilies(afterWindow());
    expect(purged).not.toContain(familyId);
    expect(await prisma.family.findUnique({ where: { id: familyId } })).not.toBeNull();
  });

  it("is idempotent: a second run is a clean no-op", async () => {
    await requestAccountDeletion(familyId);
    const first = await purgeDueDeletedFamilies(afterWindow());
    expect(first).toContain(familyId);
    const second = await purgeDueDeletedFamilies(afterWindow());
    expect(second).not.toContain(familyId);
  });
});
