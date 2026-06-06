import { describe, it, expect, beforeEach, afterEach } from "vitest";
import prisma from "../../src/db/prisma.js";
import {
  createChild,
  softDeleteChild,
  restoreChild,
  purgeDueSoftDeleted,
} from "../../src/modules/children/children.service.js";

// End-to-end child purge + username release (US3, SC-005/006): <7d not purged & restorable;
// restored excluded; ≥7d purged and the username freed so a re-create succeeds.

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

let familyId: string;

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
  const family = await prisma.family.create({ data: { name: "purge-int-family" } });
  familyId = family.id;
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

describe("child purge lifecycle", () => {
  it("a <7d soft-deleted child is not purged and stays restorable", async () => {
    const uniq = Math.random().toString(36).slice(2, 8);
    const child = await createChild(familyId, childInput(`purge_a_${uniq}`));
    await softDeleteChild(familyId, child.id);

    const purged = await purgeDueSoftDeleted(new Date(Date.now() + 24 * 60 * 60 * 1000));
    expect(purged).not.toContain(child.id);

    // Still restorable.
    const restored = await restoreChild(familyId, child.id);
    expect(restored.deletedAt).toBeNull();
  });

  it("a restored child is excluded from a later purge run", async () => {
    const uniq = Math.random().toString(36).slice(2, 8);
    const child = await createChild(familyId, childInput(`purge_b_${uniq}`));
    await softDeleteChild(familyId, child.id);
    await restoreChild(familyId, child.id);

    const purged = await purgeDueSoftDeleted(new Date(Date.now() + SEVEN_DAYS + 1000));
    expect(purged).not.toContain(child.id);
    expect(await prisma.child.findUnique({ where: { id: child.id } })).not.toBeNull();
  });

  it("a ≥7d soft-deleted child is purged and the username is freed for reuse (SC-006)", async () => {
    const uniq = Math.random().toString(36).slice(2, 8);
    const username = `purge_c_${uniq}`;
    const child = await createChild(familyId, childInput(username));
    await softDeleteChild(familyId, child.id);

    const purged = await purgeDueSoftDeleted(new Date(Date.now() + SEVEN_DAYS + 1000));
    expect(purged).toContain(child.id);
    expect(await prisma.child.findUnique({ where: { id: child.id } })).toBeNull();

    // The username is free — a brand-new child can take it.
    const recreated = await createChild(familyId, childInput(username));
    expect(recreated.id).not.toBe(child.id);
    expect(recreated.usernameNormalized).toBe(username);
  });
});
