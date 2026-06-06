import { describe, it, expect, beforeEach, afterEach } from "vitest";
import prisma from "../../src/db/prisma.js";
import {
  softDeleteChild,
  restoreChild,
  purgeDueSoftDeleted,
} from "../../src/modules/children/children.service.js";

// Purge due-window + restore-race re-check (FR-013/014). A soft-deleted child gets a
// purgeAfter = deletedAt + 7d; only children past that window are purged, restore clears
// the marker, and the purge is idempotent.

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

let familyId: string;

async function makeChild(suffix: string): Promise<string> {
  const child = await prisma.child.create({
    data: {
      familyId,
      displayName: `Child ${suffix}`,
      dob: new Date("2014-01-01"),
      gender: "MALE",
      country: "SA",
      grade: "Grade 5",
      curriculum: "BRITISH",
      subjects: ["Mathematics"],
      username: `purge_${suffix}`,
      usernameNormalized: `purge_${suffix}`,
    },
  });
  return child.id;
}

beforeEach(async () => {
  const family = await prisma.family.create({ data: { name: "purge-unit-family" } });
  familyId = family.id;
  // A plan + subscription so restore's slot re-check passes.
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
  await prisma.subscription.create({
    data: {
      familyId,
      planId: plan.id,
      status: "ACTIVE",
      billingCycle: "MONTHLY",
      currentPeriodEnd: new Date(Date.now() + SEVEN_DAYS),
    },
  });
});

afterEach(async () => {
  await prisma.child.deleteMany({ where: { familyId } });
  await prisma.subscription.deleteMany({ where: { familyId } });
  await prisma.family.deleteMany({ where: { id: familyId } });
});

describe("purgeDueSoftDeleted", () => {
  it("does not purge a child still inside the 7-day window", async () => {
    const id = await makeChild(Math.random().toString(36).slice(2, 8));
    await softDeleteChild(familyId, id);

    // now = 1 day after deletion → not due.
    const purged = await purgeDueSoftDeleted(new Date(Date.now() + 1 * 24 * 60 * 60 * 1000));
    expect(purged).not.toContain(id);
    expect(await prisma.child.findUnique({ where: { id } })).not.toBeNull();
  });

  it("purges a child past the 7-day window", async () => {
    const id = await makeChild(Math.random().toString(36).slice(2, 8));
    await softDeleteChild(familyId, id);

    const purged = await purgeDueSoftDeleted(new Date(Date.now() + SEVEN_DAYS + 1000));
    expect(purged).toContain(id);
    expect(await prisma.child.findUnique({ where: { id } })).toBeNull();
  });

  it("excludes a restored child (restore clears purgeAfter) — the restore race", async () => {
    const id = await makeChild(Math.random().toString(36).slice(2, 8));
    await softDeleteChild(familyId, id);
    await restoreChild(familyId, id);

    const purged = await purgeDueSoftDeleted(new Date(Date.now() + SEVEN_DAYS + 1000));
    expect(purged).not.toContain(id);
    const fresh = await prisma.child.findUnique({ where: { id } });
    expect(fresh?.deletedAt).toBeNull();
    expect(fresh?.purgeAfter).toBeNull();
  });

  it("is idempotent: a second purge run is a no-op", async () => {
    const id = await makeChild(Math.random().toString(36).slice(2, 8));
    await softDeleteChild(familyId, id);
    const future = new Date(Date.now() + SEVEN_DAYS + 1000);

    const first = await purgeDueSoftDeleted(future);
    expect(first).toContain(id);
    const second = await purgeDueSoftDeleted(future);
    expect(second).not.toContain(id);
  });
});
