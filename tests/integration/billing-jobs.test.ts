import { describe, it, expect, beforeEach, afterEach } from "vitest";
import prisma from "../../src/db/prisma.js";
import {
  purgeDueCanceled,
  dispatchBillingNotifications,
} from "../../src/modules/billing/billing.service.js";

// Deferred billing jobs end-to-end (US5, FR-023/024): a canceled subscription is retained
// within its window and purged past it; a PAST_DUE/renewal condition dispatches a billing
// notification through the central dispatcher.

let familyId: string;
let planId: string;

beforeEach(async () => {
  const family = await prisma.family.create({ data: { name: "billing-jobs-family" } });
  familyId = family.id;
  const plan = await prisma.plan.upsert({
    where: { key: "FAMILY" },
    update: {},
    create: {
      key: "FAMILY",
      name: "Family",
      subtitle: "test",
      childLimit: 3,
      monthlyPriceMinor: 2000,
      yearlyPriceMinor: 20000,
      yearlyDiscountMinor: 0,
      currency: "SAR",
      features: [],
    },
  });
  planId = plan.id;
});

afterEach(async () => {
  await prisma.notification.deleteMany({ where: { familyId } });
  await prisma.invoice.deleteMany({ where: { subscription: { familyId } } });
  await prisma.paymentIntent.deleteMany({ where: { familyId } });
  await prisma.subscription.deleteMany({ where: { familyId } });
  await prisma.family.deleteMany({ where: { id: familyId } });
});

describe("billing jobs", () => {
  it("retains a canceled subscription within its 30-day window, purges it past it", async () => {
    const sub = await prisma.subscription.create({
      data: {
        familyId,
        planId,
        status: "CANCELED",
        billingCycle: "MONTHLY",
        currentPeriodEnd: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        canceledEffectiveAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      },
    });

    // Within window → not purged.
    expect(await purgeDueCanceled(new Date())).not.toContain(sub.id);
    expect(await prisma.subscription.findUnique({ where: { id: sub.id } })).not.toBeNull();

    // Past the window → purged.
    const future = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    expect(await purgeDueCanceled(future)).toContain(sub.id);
    expect(await prisma.subscription.findUnique({ where: { id: sub.id } })).toBeNull();
  });

  it("dispatches a dunning notification for a PAST_DUE subscription (FR-024)", async () => {
    await prisma.subscription.create({
      data: {
        familyId,
        planId,
        status: "PAST_DUE",
        billingCycle: "MONTHLY",
        currentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      },
    });

    await dispatchBillingNotifications(new Date());

    const dunning = await prisma.notification.findFirst({
      where: { familyId, source: "BILLING", recipient: "PARENT" },
    });
    expect(dunning).not.toBeNull();
    expect(dunning?.countsAgainstCap).toBe(false);
  });

  it("dispatches a renewal notice when the period end is within the lookahead window", async () => {
    await prisma.subscription.create({
      data: {
        familyId,
        planId,
        status: "ACTIVE",
        billingCycle: "MONTHLY",
        currentPeriodEnd: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // within 3-day lookahead
      },
    });

    const dispatched = await dispatchBillingNotifications(new Date());
    expect(dispatched).toBeGreaterThanOrEqual(1);

    const renewal = await prisma.notification.count({
      where: { familyId, source: "BILLING" },
    });
    expect(renewal).toBeGreaterThanOrEqual(1);
  });
});
