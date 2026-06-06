import { describe, it, expect, beforeEach, afterEach } from "vitest";
import prisma from "../../src/db/prisma.js";
import { processSessionEvent } from "../../src/modules/sessionEvents/sessionEvents.service.js";

// Progress/XP/level/streak derivation from session events (US4, FR-020/022, SC-007/008):
// a sequence of events yields the expected Child snapshot + SubjectProgress/TopicProgress;
// a duplicate eventId applies once; the struggle path surfaces a reminder.

let familyId: string;
let childId: string;
let seq = 0;

function ev(overrides: Record<string, unknown>): Record<string, unknown> {
  seq += 1;
  return {
    eventId: `evt_pd_${Date.now()}_${seq}`,
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
  const family = await prisma.family.create({ data: { name: "progress-family" } });
  familyId = family.id;
  const uniq = Math.random().toString(36).slice(2, 10);
  const child = await prisma.child.create({
    data: {
      familyId,
      displayName: "Progress Child",
      dob: new Date("2014-01-01"),
      gender: "FEMALE",
      country: "SA",
      grade: "Grade 5",
      curriculum: "BRITISH",
      subjects: ["Mathematics"],
      username: `pd_${uniq}`,
      usernameNormalized: `pd_${uniq}`,
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
  await prisma.child.deleteMany({ where: { familyId } });
  await prisma.family.deleteMany({ where: { id: familyId } });
});

async function child() {
  return prisma.child.findUniqueOrThrow({ where: { id: childId } });
}

describe("progress derivation", () => {
  it("accumulates XP, minutes, and level from a sequence of sessions (FR-020)", async () => {
    await processSessionEvent(ev({ xpEarned: 400, durationMinutes: 30 }));
    await processSessionEvent(ev({ xpEarned: 700, durationMinutes: 25 }));

    const c = await child();
    expect(c.totalXp).toBe(1100);
    expect(c.totalMinutes).toBe(55);
    // 1100 xp → level 2 (one 1000-span rollover), levelXp 100.
    expect(c.level).toBe(2);
    expect(c.levelXp).toBe(100);
  });

  it("derives SubjectProgress + TopicProgress mastery (SC-007)", async () => {
    await processSessionEvent(ev({ masteryByTopic: { Fractions: 65 } }));

    const subject = await prisma.subjectProgress.findFirst({
      where: { childId, subject: "Mathematics" },
    });
    expect(subject?.mastery).toBe(65);

    const topic = await prisma.topicProgress.findFirst({
      where: { subjectProgressId: subject!.id, name: "Fractions" },
    });
    expect(topic?.mastery).toBe(65);
  });

  it("a duplicate eventId does not double-count progress (FR-022)", async () => {
    const event = ev({ xpEarned: 200, durationMinutes: 20 });
    await processSessionEvent(event);
    const afterFirst = await child();

    const dup = await processSessionEvent(event);
    expect(dup.status).toBe("duplicate");

    const afterDup = await child();
    expect(afterDup.totalXp).toBe(afterFirst.totalXp);
    expect(afterDup.totalMinutes).toBe(afterFirst.totalMinutes);
  });

  it("3 consecutive low-mastery sessions surface a STRUGGLE_ALERT reminder (SC-008)", async () => {
    await processSessionEvent(ev({ masteryByTopic: { Fractions: 20 } }));
    await processSessionEvent(ev({ masteryByTopic: { Fractions: 30 } }));
    await processSessionEvent(ev({ masteryByTopic: { Fractions: 25 } }));

    const alerts = await prisma.notification.count({
      where: { familyId, type: "STRUGGLE_ALERT" },
    });
    expect(alerts).toBe(1);
  });
});
