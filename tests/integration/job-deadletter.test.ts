import { describe, it, expect, beforeEach, afterEach } from "vitest";
import prisma from "../../src/db/prisma.js";
import { markDeadLettered, recordAttempt } from "../../src/modules/notifications/notifications.service.js";
import { defaultJobOptions } from "../../src/jobs/queues.js";

// Dead-letter / retention behavior (FR-026): exhausted jobs are retained (not dropped),
// and an exhausted notification delivery marks the row DEAD_LETTERED while preserving its
// attempt count (the cap is never recounted). We assert the retention policy and the
// service-level dead-letter transition the worker invokes on exhaustion.

let familyId: string;

beforeEach(async () => {
  const family = await prisma.family.create({ data: { name: "dlq-family" } });
  familyId = family.id;
});

afterEach(async () => {
  await prisma.notification.deleteMany({ where: { familyId } });
  await prisma.family.deleteMany({ where: { id: familyId } });
});

describe("dead-letter behavior", () => {
  it("failed jobs are retained (removeOnFail is false) with bounded retries", () => {
    expect(defaultJobOptions.removeOnFail).toBe(false);
    expect(defaultJobOptions.attempts).toBeGreaterThanOrEqual(5);
    expect(defaultJobOptions.backoff).toMatchObject({ type: "exponential" });
  });

  it("exhausting retries marks the notification DEAD_LETTERED without losing attempts", async () => {
    const notification = await prisma.notification.create({
      data: {
        familyId,
        recipient: "PARENT",
        title: "to be dead-lettered",
        source: "BILLING",
        channels: ["EMAIL"],
        dispatchStatus: "PENDING",
      },
    });

    // Simulate retry attempts then exhaustion (what the worker does on each failure).
    await recordAttempt(notification.id);
    await recordAttempt(notification.id);
    await markDeadLettered(notification.id);

    const row = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    expect(row.dispatchStatus).toBe("DEAD_LETTERED");
    expect(row.attemptCount).toBe(2); // attempts preserved, not reset
    // The row still exists (retained for inspection), never silently dropped.
    expect(row.id).toBe(notification.id);
  });
});
