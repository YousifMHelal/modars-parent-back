import { describe, it, expect, beforeEach, afterEach } from "vitest";
import prisma from "../../src/db/prisma.js";
import { runRemindersSweep } from "../../src/modules/reminders/reminders.service.js";
import type { ReminderType, ReminderRecipient } from "../../src/generated/prisma/client.js";

// End-to-end reminders sweep (US1, FR-004/005/007/010): a seeded child with several due
// reminders → notifications created per recipient/channel, the central max-3/day cap
// honored, and a re-run (retry) does not double-count (FR-010).

const NOW = new Date("2026-06-06T08:00:00.000Z"); // capDay 2026-06-06

let familyId: string;
let childId: string;

async function addReminder(type: ReminderType, recipient: ReminderRecipient): Promise<void> {
  await prisma.reminderConfig.create({
    data: { familyId, childId, type, enabled: true, recipient },
  });
}

beforeEach(async () => {
  const family = await prisma.family.create({ data: { name: "sweep-test-family" } });
  familyId = family.id;
  const uniq = Math.random().toString(36).slice(2, 10);
  const child = await prisma.child.create({
    data: {
      familyId,
      displayName: "Sweep Child",
      dob: new Date("2014-01-01"),
      gender: "FEMALE",
      country: "SA",
      grade: "Grade 5",
      curriculum: "BRITISH",
      subjects: ["Mathematics"],
      username: `sweep_${uniq}`,
      usernameNormalized: `sweep_${uniq}`,
    },
  });
  childId = child.id;
});

afterEach(async () => {
  await prisma.notification.deleteMany({ where: { familyId } });
  await prisma.reminderConfig.deleteMany({ where: { familyId } });
  await prisma.child.deleteMany({ where: { familyId } });
  await prisma.family.deleteMany({ where: { id: familyId } });
});

describe("reminders sweep", () => {
  it("creates notifications per recipient and honors the daily cap", async () => {
    // 5 sweep-driven types, all CHILD-addressed → only 3 child-capped survive.
    await addReminder("MISSED_SESSION", "CHILD");
    await addReminder("HOMEWORK_DUE", "CHILD");
    await addReminder("STREAK_PROTECTION", "CHILD");
    await addReminder("DAILY_STUDY", "CHILD");
    await addReminder("WEEKLY_SUMMARY", "CHILD");

    const result = await runRemindersSweep(NOW);
    expect(result.children).toBeGreaterThanOrEqual(1);

    const capped = await prisma.notification.count({
      where: { childId, countsAgainstCap: true, dispatchStatus: { in: ["PENDING", "SENT"] } },
    });
    expect(capped).toBe(3);

    const suppressed = await prisma.notification.count({
      where: { childId, dispatchStatus: "SUPPRESSED" },
    });
    expect(suppressed).toBe(2);
  });

  it("addresses Parent-recipient reminders to the parent without counting the cap", async () => {
    await addReminder("MISSED_SESSION", "PARENT"); // parent-only
    await addReminder("WEEKLY_SUMMARY", "PARENT");
    await addReminder("HOMEWORK_DUE", "BOTH"); // both: 1 child (capped) + 1 parent

    await runRemindersSweep(NOW);

    const parentRows = await prisma.notification.count({
      where: { childId, recipient: "PARENT" },
    });
    expect(parentRows).toBe(3); // 2 parent-only + 1 from BOTH

    const childCapped = await prisma.notification.count({
      where: { childId, recipient: "CHILD", countsAgainstCap: true },
    });
    expect(childCapped).toBe(1); // only the BOTH child side
  });

  it("is idempotent: a second sweep on the same day does not double-count (FR-010)", async () => {
    await addReminder("MISSED_SESSION", "CHILD");
    await addReminder("HOMEWORK_DUE", "CHILD");

    await runRemindersSweep(NOW);
    const firstCount = await prisma.notification.count({ where: { childId } });

    await runRemindersSweep(NOW);
    const secondCount = await prisma.notification.count({ where: { childId } });
    expect(secondCount).toBe(firstCount);
  });
});
