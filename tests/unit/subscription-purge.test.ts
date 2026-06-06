import { describe, it, expect, beforeEach, afterEach } from "vitest";
import prisma from "../../src/db/prisma.js";
import { purgeDueCanceled } from "../../src/modules/billing/billing.service.js";

// Subscription purge window (FR-023, SC-009): a CANCELED subscription is purged only when
// canceledEffectiveAt <= now; the purge is idempotent.

let familyId: string;
let planId: string;

async function makeSub(
  status: "CANCELED" | "ACTIVE",
  canceledEffectiveAt: Date | null,
): Promise<string> {
  const sub = await prisma.subscription.create({
    data: {
      familyId,
      planId,
      status,
      billingCycle: "MONTHLY",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      canceledEffectiveAt,
    },
  });
  return sub.id;
}

beforeEach(async () => {
  const family = await prisma.family.create({ data: { name: "subpurge-family" } });
  familyId = family.id;
  const plan = await prisma.plan.upsert({
    where: { key: "STARTER" },
    update: {},
    create: {
      key: "STARTER",
      name: "Starter",
      subtitle: "test",
      childLimit: 1,
      monthlyPriceMinor: 1000,
      yearlyPriceMinor: 10000,
      yearlyDiscountMinor: 0,
      currency: "SAR",
      features: [],
    },
  });
  planId = plan.id;
});

afterEach(async () => {
  await prisma.subscription.deleteMany({ where: { familyId } });
  await prisma.family.deleteMany({ where: { id: familyId } });
});

describe("purgeDueCanceled", () => {
  it("does not purge a canceled subscription still inside the retain window", async () => {
    const id = await makeSub("CANCELED", new Date(Date.now() + 5 * 24 * 60 * 60 * 1000));
    const purged = await purgeDueCanceled(new Date());
    expect(purged).not.toContain(id);
    expect(await prisma.subscription.findUnique({ where: { id } })).not.toBeNull();
  });

  it("purges a canceled subscription past canceledEffectiveAt", async () => {
    const id = await makeSub("CANCELED", new Date(Date.now() - 1000));
    const purged = await purgeDueCanceled(new Date());
    expect(purged).toContain(id);
    expect(await prisma.subscription.findUnique({ where: { id } })).toBeNull();
  });

  it("never purges a non-canceled subscription", async () => {
    const id = await makeSub("ACTIVE", null);
    const purged = await purgeDueCanceled(new Date());
    expect(purged).not.toContain(id);
  });

  it("is idempotent: a second run is a no-op", async () => {
    const id = await makeSub("CANCELED", new Date(Date.now() - 1000));
    const first = await purgeDueCanceled(new Date());
    expect(first).toContain(id);
    const second = await purgeDueCanceled(new Date());
    expect(second).not.toContain(id);
  });
});
