import { describe, it, expect, beforeEach, afterEach } from "vitest";
import prisma from "../../src/db/prisma.js";
import { runRemindersSweep } from "../../src/modules/reminders/reminders.service.js";
import { processSessionEvent } from "../../src/modules/sessionEvents/sessionEvents.service.js";
import { softDeleteChild, purgeDueSoftDeleted } from "../../src/modules/children/children.service.js";
import { purgeDueCanceled } from "../../src/modules/billing/billing.service.js";

// Cross-cutting idempotency (FR-002, SC-010): every state-mutating job applies its effect
// exactly once under retry/duplicate — notification dispatch, child purge, subscription
// purge, and homework/progress derivation.

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
let familyId: string;
let childId: string;
let planId: string;

beforeEach(async () => {
  const family = await prisma.family.create({ data: { name: "idem-family" } });
  familyId = family.id;
  const uniq = Math.random().toString(36).slice(2, 10);
  const child = await prisma.child.create({
    data: {
      familyId,
      displayName: "Idem Child",
      dob: new Date("2014-01-01"),
      gender: "MALE",
      country: "SA",
      grade: "Grade 5",
      curriculum: "BRITISH",
      subjects: ["Mathematics"],
      username: `idem_${uniq}`,
      usernameNormalized: `idem_${uniq}`,
    },
  });
  childId = child.id;
  const plan = await prisma.plan.upsert({
    where: { key: "FAMILY_PRO" },
    update: {},
    create: {
      key: "FAMILY_PRO",
      name: "Family Pro",
      subtitle: "t",
      childLimit: 10,
      monthlyPriceMinor: 1,
      yearlyPriceMinor: 1,
      yearlyDiscountMinor: 0,
      currency: "SAR",
      features: [],
    },
  });
  planId = plan.id;
});

afterEach(async () => {
  await prisma.processedSessionEvent.deleteMany({ where: { familyId } });
  await prisma.notification.deleteMany({ where: { familyId } });
  await prisma.topicProgress.deleteMany({ where: { subjectProgress: { familyId } } });
  await prisma.subjectProgress.deleteMany({ where: { familyId } });
  await prisma.struggleTracker.deleteMany({ where: { familyId } });
  await prisma.reminderConfig.deleteMany({ where: { familyId } });
  await prisma.homework.deleteMany({ where: { familyId } });
  await prisma.invoice.deleteMany({ where: { subscription: { familyId } } });
  await prisma.subscription.deleteMany({ where: { familyId } });
  await prisma.child.deleteMany({ where: { familyId } });
  await prisma.family.deleteMany({ where: { id: familyId } });
});

describe("job idempotency", () => {
  it("notification dispatch: a re-run sweep does not duplicate notifications", async () => {
    await prisma.reminderConfig.create({
      data: { familyId, childId, type: "MISSED_SESSION", enabled: true, recipient: "CHILD" },
    });
    const now = new Date("2026-06-06T08:00:00Z");
    await runRemindersSweep(now);
    const first = await prisma.notification.count({ where: { childId } });
    await runRemindersSweep(now);
    const second = await prisma.notification.count({ where: { childId } });
    expect(second).toBe(first);
  });

  it("homework + progress: a duplicate session event applies once", async () => {
    const hw = await prisma.homework.create({
      data: { familyId, childId, subject: "Mathematics", topic: "Fractions", deadline: new Date("2026-06-10T12:00:00Z"), status: "PENDING" },
    });
    const event = {
      eventId: `evt_idem_${Date.now()}`,
      familyId,
      childId,
      subject: "Mathematics",
      topics: ["Fractions"],
      masteryByTopic: { Fractions: 90 },
      durationMinutes: 20,
      xpEarned: 150,
      outcome: "completed",
      homeworkRef: hw.id,
      occurredAt: "2026-06-09T12:00:00Z",
    };
    await processSessionEvent(event);
    const c1 = await prisma.child.findUniqueOrThrow({ where: { id: childId } });

    const dup = await processSessionEvent(event);
    expect(dup.status).toBe("duplicate");
    const c2 = await prisma.child.findUniqueOrThrow({ where: { id: childId } });
    expect(c2.totalXp).toBe(c1.totalXp); // not doubled
    expect((await prisma.homework.findUniqueOrThrow({ where: { id: hw.id } })).status).toBe("COMPLETED");
  });

  it("child purge: a re-run does not error and the child stays gone", async () => {
    await softDeleteChild(familyId, childId);
    const future = new Date(Date.now() + SEVEN_DAYS + 1000);
    expect(await purgeDueSoftDeleted(future)).toContain(childId);
    expect(await purgeDueSoftDeleted(future)).not.toContain(childId);
    expect(await prisma.child.findUnique({ where: { id: childId } })).toBeNull();
  });

  it("subscription purge: a re-run is a no-op after the first purge", async () => {
    const sub = await prisma.subscription.create({
      data: {
        familyId,
        planId,
        status: "CANCELED",
        billingCycle: "MONTHLY",
        currentPeriodEnd: new Date(Date.now() - 1000),
        canceledEffectiveAt: new Date(Date.now() - 1000),
      },
    });
    const now = new Date();
    expect(await purgeDueCanceled(now)).toContain(sub.id);
    expect(await purgeDueCanceled(now)).not.toContain(sub.id);
  });
});
