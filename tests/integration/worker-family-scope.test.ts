import { describe, it, expect, beforeEach, afterEach } from "vitest";
import prisma from "../../src/db/prisma.js";
import { runRemindersSweep } from "../../src/modules/reminders/reminders.service.js";
import { processSessionEvent } from "../../src/modules/sessionEvents/sessionEvents.service.js";

// Family-scope invariant across workers (FR-003/025, SC-011): no job notifies or mutates
// across families. A reminder sweep produces notifications only inside the owning family;
// a session event resolves its family from the payload and never touches another family.

let famA: string;
let famB: string;
let childA: string;
let childB: string;

async function makeFamilyWithChild(name: string): Promise<{ familyId: string; childId: string }> {
  const family = await prisma.family.create({ data: { name } });
  const uniq = Math.random().toString(36).slice(2, 10);
  const child = await prisma.child.create({
    data: {
      familyId: family.id,
      displayName: `${name} child`,
      dob: new Date("2014-01-01"),
      gender: "MALE",
      country: "SA",
      grade: "Grade 5",
      curriculum: "BRITISH",
      subjects: ["Mathematics"],
      username: `fs_${uniq}`,
      usernameNormalized: `fs_${uniq}`,
    },
  });
  return { familyId: family.id, childId: child.id };
}

beforeEach(async () => {
  const a = await makeFamilyWithChild("fs-family-a");
  const b = await makeFamilyWithChild("fs-family-b");
  famA = a.familyId;
  childA = a.childId;
  famB = b.familyId;
  childB = b.childId;
});

afterEach(async () => {
  for (const fam of [famA, famB]) {
    await prisma.processedSessionEvent.deleteMany({ where: { familyId: fam } });
    await prisma.notification.deleteMany({ where: { familyId: fam } });
    await prisma.topicProgress.deleteMany({ where: { subjectProgress: { familyId: fam } } });
    await prisma.subjectProgress.deleteMany({ where: { familyId: fam } });
    await prisma.struggleTracker.deleteMany({ where: { familyId: fam } });
    await prisma.reminderConfig.deleteMany({ where: { familyId: fam } });
    await prisma.child.deleteMany({ where: { familyId: fam } });
    await prisma.family.deleteMany({ where: { id: fam } });
  }
});

describe("worker family-scope invariant", () => {
  it("a reminder sweep notifies only the owning family", async () => {
    // Only family A has a due reminder.
    await prisma.reminderConfig.create({
      data: { familyId: famA, childId: childA, type: "MISSED_SESSION", enabled: true, recipient: "CHILD" },
    });

    await runRemindersSweep(new Date("2026-06-06T08:00:00Z"));

    const aNotifs = await prisma.notification.count({ where: { familyId: famA } });
    const bNotifs = await prisma.notification.count({ where: { familyId: famB } });
    expect(aNotifs).toBeGreaterThanOrEqual(1);
    // Every notification created for child A is scoped to family A.
    const aRows = await prisma.notification.findMany({ where: { childId: childA } });
    expect(aRows.every((n) => n.familyId === famA)).toBe(true);
    // Family B's child got nothing from A's reminder.
    expect(bNotifs).toBe(0);
  });

  it("a session event mutates only its own family's child progress", async () => {
    await processSessionEvent({
      eventId: `evt_fs_${Date.now()}`,
      familyId: famA,
      childId: childA,
      subject: "Mathematics",
      topics: ["Fractions"],
      masteryByTopic: { Fractions: 70 },
      durationMinutes: 20,
      xpEarned: 200,
      outcome: "completed",
      occurredAt: "2026-06-06T09:00:00Z",
    });

    const a = await prisma.child.findUniqueOrThrow({ where: { id: childA } });
    const b = await prisma.child.findUniqueOrThrow({ where: { id: childB } });
    expect(a.totalXp).toBe(200);
    expect(b.totalXp).toBe(0); // untouched

    const aProgress = await prisma.subjectProgress.count({ where: { familyId: famA } });
    const bProgress = await prisma.subjectProgress.count({ where: { familyId: famB } });
    expect(aProgress).toBe(1);
    expect(bProgress).toBe(0);
  });
});
