import { describe, it, expect, beforeEach, afterEach } from "vitest";
import prisma from "../../src/db/prisma.js";
import { processSessionEvent } from "../../src/modules/sessionEvents/sessionEvents.service.js";

// Struggle counter behavior (FR-021): increments on a below-threshold session, resets at/
// above threshold, raises an alert at the consecutive threshold (default 3), and is
// debounced by lastAlertedAt so it doesn't re-alert every subsequent low session.
// STRUGGLE_MASTERY_THRESHOLD defaults to 50, STRUGGLE_CONSECUTIVE_THRESHOLD to 3.

let familyId: string;
let childId: string;
let seq = 0;

function lowEvent(mastery: number): Record<string, unknown> {
  seq += 1;
  return {
    eventId: `evt_st_${Date.now()}_${seq}`,
    familyId,
    childId,
    subject: "Mathematics",
    topics: ["Fractions"],
    masteryByTopic: { Fractions: mastery },
    durationMinutes: 15,
    xpEarned: 10,
    outcome: "completed",
    occurredAt: new Date(2026, 5, 6, 9, seq).toISOString(),
  };
}

async function tracker() {
  return prisma.struggleTracker.findFirst({ where: { childId, topic: "Fractions" } });
}

async function struggleAlertCount(): Promise<number> {
  return prisma.notification.count({ where: { familyId, type: "STRUGGLE_ALERT" } });
}

beforeEach(async () => {
  const family = await prisma.family.create({ data: { name: "struggle-family" } });
  familyId = family.id;
  const uniq = Math.random().toString(36).slice(2, 10);
  const child = await prisma.child.create({
    data: {
      familyId,
      displayName: "Struggle Child",
      dob: new Date("2014-01-01"),
      gender: "MALE",
      country: "SA",
      grade: "Grade 5",
      curriculum: "BRITISH",
      subjects: ["Mathematics"],
      username: `st_${uniq}`,
      usernameNormalized: `st_${uniq}`,
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

describe("struggle tracker", () => {
  it("increments the counter on consecutive low-mastery sessions", async () => {
    await processSessionEvent(lowEvent(30));
    expect((await tracker())?.consecutiveLowMastery).toBe(1);
    await processSessionEvent(lowEvent(40));
    expect((await tracker())?.consecutiveLowMastery).toBe(2);
  });

  it("resets to 0 when a session is at/above the mastery threshold", async () => {
    await processSessionEvent(lowEvent(30));
    await processSessionEvent(lowEvent(40));
    await processSessionEvent(lowEvent(70)); // recovered
    expect((await tracker())?.consecutiveLowMastery).toBe(0);
  });

  it("raises a STRUGGLE_ALERT at the 3rd consecutive low session and flags the topic", async () => {
    await processSessionEvent(lowEvent(20));
    await processSessionEvent(lowEvent(25));
    expect(await struggleAlertCount()).toBe(0);

    await processSessionEvent(lowEvent(30)); // 3rd → alert
    expect(await struggleAlertCount()).toBe(1);

    const topic = await prisma.topicProgress.findFirst({
      where: { subjectProgress: { childId }, name: "Fractions" },
    });
    expect(topic?.struggling).toBe(true);
  });

  it("debounces: a 4th consecutive low session does not raise a second alert", async () => {
    await processSessionEvent(lowEvent(20));
    await processSessionEvent(lowEvent(25));
    await processSessionEvent(lowEvent(30)); // alert #1
    await processSessionEvent(lowEvent(35)); // still struggling, debounced
    expect(await struggleAlertCount()).toBe(1);
  });
});
