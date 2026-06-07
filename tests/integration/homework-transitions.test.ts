import { describe, it, expect, beforeEach, afterEach } from "vitest";
import prisma from "../../src/db/prisma.js";
import { processSessionEvent } from "../../src/modules/sessionEvents/sessionEvents.service.js";
import { sweepOverdueHomework } from "../../src/modules/homework/homework.service.js";
import type { HomeworkStatus } from "../../src/generated/prisma/client.js";

// Session events drive homework transitions end-to-end, idempotently (FR-015–018, SC-004).
// A duplicate eventId applies once; the homework status is server-set only — there is no
// client endpoint that writes it (Principle VI / FR-017), asserted structurally below.

let familyId: string;
let childId: string;

async function makeHomework(subject: string, topic: string, deadline: Date): Promise<string> {
  const hw = await prisma.homework.create({
    data: { familyId, childId, subject, topic, deadline, status: "PENDING" },
  });
  return hw.id;
}

async function status(id: string): Promise<HomeworkStatus> {
  const hw = await prisma.homework.findUniqueOrThrow({ where: { id } });
  return hw.status;
}

let eventCounter = 0;
function event(overrides: Record<string, unknown>): Record<string, unknown> {
  eventCounter += 1;
  return {
    eventId: `evt_hw_${Date.now()}_${eventCounter}`,
    familyId,
    childId,
    subject: "Mathematics",
    topics: ["Fractions"],
    masteryByTopic: { Fractions: 80 },
    durationMinutes: 20,
    xpEarned: 50,
    outcome: "completed",
    occurredAt: "2026-06-09T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(async () => {
  const family = await prisma.family.create({ data: { name: "hw-test-family" } });
  familyId = family.id;
  const uniq = Math.random().toString(36).slice(2, 10);
  const child = await prisma.child.create({
    data: {
      familyId,
      displayName: "HW Child",
      dob: new Date("2014-01-01"),
      gender: "MALE",
      country: "SA",
      grade: "Grade 5",
      curriculum: "BRITISH",
      subjects: ["Mathematics"],
      username: `hw_${uniq}`,
      usernameNormalized: `hw_${uniq}`,
    },
  });
  childId = child.id;
});

afterEach(async () => {
  await prisma.processedSessionEvent.deleteMany({ where: { familyId } });
  await prisma.notification.deleteMany({ where: { familyId } });
  await prisma.struggleTracker.deleteMany({ where: { childId } });
  await prisma.topicProgress.deleteMany({
    where: { subjectProgress: { childId } },
  });
  await prisma.subjectProgress.deleteMany({ where: { childId } });
  await prisma.homework.deleteMany({ where: { familyId } });
  await prisma.child.deleteMany({ where: { familyId } });
  await prisma.family.deleteMany({ where: { id: familyId } });
});

describe("homework transitions from session events", () => {
  it("started → IN_PROGRESS, then completed before deadline → COMPLETED", async () => {
    const hwId = await makeHomework("Mathematics", "Fractions", new Date("2026-06-10T12:00:00Z"));

    await processSessionEvent(event({ outcome: "started", homeworkRef: hwId }));
    expect(await status(hwId)).toBe("IN_PROGRESS");

    await processSessionEvent(
      event({ outcome: "completed", homeworkRef: hwId, occurredAt: "2026-06-09T12:00:00Z" }),
    );
    expect(await status(hwId)).toBe("COMPLETED");
  });

  it("an item past deadline becomes OVERDUE via the sweep, then COMPLETED_LATE on completion", async () => {
    const hwId = await makeHomework("Mathematics", "Fractions", new Date("2026-06-08T12:00:00Z"));

    const overdueCount = await sweepOverdueHomework(new Date("2026-06-09T00:00:00Z"));
    expect(overdueCount).toBeGreaterThanOrEqual(1);
    expect(await status(hwId)).toBe("OVERDUE");

    await processSessionEvent(
      event({ outcome: "completed", homeworkRef: hwId, occurredAt: "2026-06-09T12:00:00Z" }),
    );
    expect(await status(hwId)).toBe("COMPLETED_LATE");
  });

  it("matches by (childId, subject, topic) when no homeworkRef is given", async () => {
    const hwId = await makeHomework("Mathematics", "Fractions", new Date("2026-06-10T12:00:00Z"));
    await processSessionEvent(event({ outcome: "started" }));
    expect(await status(hwId)).toBe("IN_PROGRESS");
  });

  it("a duplicate eventId applies the transition only once (FR-018)", async () => {
    const hwId = await makeHomework("Mathematics", "Fractions", new Date("2026-06-10T12:00:00Z"));
    const ev = event({ outcome: "completed", homeworkRef: hwId, occurredAt: "2026-06-09T12:00:00Z" });

    const first = await processSessionEvent(ev);
    expect(first.status).toBe("processed");
    expect(await status(hwId)).toBe("COMPLETED");

    // Re-deliver the SAME eventId → no-op (ledger dedup).
    const second = await processSessionEvent(ev);
    expect(second.status).toBe("duplicate");

    const ledgerCount = await prisma.processedSessionEvent.count({
      where: { eventId: ev["eventId"] as string },
    });
    expect(ledgerCount).toBe(1);
  });

  it("server-authoritative: the create route does not let a client set homework status (FR-017)", async () => {
    // Parents may CREATE homework (FR-014), but status is never client-settable — it is
    // only set by the session-event pipeline, the deadline sweep, and the server-chosen
    // initial value on create. Assert the create schema accepts no `status` field.
    const { createHomeworkSchema } = await import("../../src/modules/homework/homework.schema.js");
    const parsed = createHomeworkSchema.body.parse({
      subject: "Mathematics",
      topic: "Fractions",
      deadline: "2999-01-01",
      // A client attempting to set status must not have it honored.
      status: "COMPLETED",
    });
    expect(parsed).not.toHaveProperty("status");
  });
});
