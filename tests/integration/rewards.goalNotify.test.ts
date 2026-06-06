import { describe, it, expect, beforeEach, afterEach } from "vitest";
import prisma from "../../src/db/prisma.js";
import { processSessionEvent } from "../../src/modules/sessionEvents/sessionEvents.service.js";

// US2 / research §4: a session event that pushes a child over a reward's goal raises the
// existing REWARD_REDEEMED notification through the Phase 6 engine, counts against the
// per-child daily cap, and NEVER changes the reward's status.

let familyId: string;
let childId: string;
let seq = 0;

function ev(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1;
  return {
    eventId: `evt_gn_${Date.now()}_${seq}`,
    familyId,
    childId,
    subject: "Mathematics",
    topics: ["Fractions"],
    masteryByTopic: { Fractions: 80 },
    durationMinutes: 20,
    xpEarned: 100,
    outcome: "completed",
    occurredAt: new Date(2026, 5, 6, 9, seq).toISOString(),
    ...overrides,
  };
}

beforeEach(async () => {
  const family = await prisma.family.create({ data: { name: "goal-notify-family" } });
  familyId = family.id;
  const uniq = Math.random().toString(36).slice(2, 10);
  const child = await prisma.child.create({
    data: {
      familyId,
      displayName: "Goal Child",
      dob: new Date("2014-01-01"),
      gender: "MALE",
      country: "SA",
      grade: "Grade 5",
      curriculum: "BRITISH",
      subjects: ["Mathematics"],
      username: `gn_${uniq}`,
      usernameNormalized: `gn_${uniq}`,
    },
  });
  childId = child.id;
});

afterEach(async () => {
  await prisma.processedSessionEvent.deleteMany({ where: { familyId } });
  await prisma.notification.deleteMany({ where: { familyId } });
  await prisma.struggleTracker.deleteMany({ where: { childId } });
  await prisma.topicProgress.deleteMany({ where: { subjectProgress: { childId } } });
  await prisma.subjectProgress.deleteMany({ where: { childId } });
  await prisma.reward.deleteMany({ where: { familyId } });
  await prisma.child.deleteMany({ where: { familyId } });
  await prisma.family.deleteMany({ where: { id: familyId } });
});

describe("reward goal-met notification (US2)", () => {
  it("enqueues a REWARD_REDEEMED notification, counts the cap, and keeps the reward ACTIVE", async () => {
    const reward = await prisma.reward.create({
      data: {
        familyId,
        childId,
        title: "New bike",
        goalMetric: "XP",
        goalTarget: 150,
        status: "ACTIVE",
      },
    });

    // One event of 200 XP pushes the child over the 150 XP goal.
    await processSessionEvent(ev({ xpEarned: 200 }));

    const notifs = await prisma.notification.findMany({
      where: { familyId, type: "REWARD_REDEEMED" },
    });
    expect(notifs).toHaveLength(1);
    expect(notifs[0]!.childId).toBe(childId);
    expect(notifs[0]!.countsAgainstCap).toBe(true);

    // Status is unchanged — goal-met never fulfills.
    const fresh = await prisma.reward.findUniqueOrThrow({ where: { id: reward.id } });
    expect(fresh.status).toBe("ACTIVE");
    expect(fresh.fulfilledAt).toBeNull();
  });

  it("does not raise a notification when the goal is not yet met", async () => {
    await prisma.reward.create({
      data: {
        familyId,
        childId,
        title: "Far goal",
        goalMetric: "XP",
        goalTarget: 100000,
        status: "ACTIVE",
      },
    });

    await processSessionEvent(ev({ xpEarned: 100 }));

    const count = await prisma.notification.count({
      where: { familyId, type: "REWARD_REDEEMED" },
    });
    expect(count).toBe(0);
  });
});
