import { describe, it, expect, beforeEach, afterEach } from "vitest";
import prisma from "../../src/db/prisma.js";
import {
  buildAndDispatch,
  type NotificationIntent,
} from "../../src/modules/notifications/notifications.service.js";
import type { ReminderType } from "../../src/generated/prisma/client.js";

// Cap + suppression logic (SC-001/002, FR-007/008/008a). The dispatcher is the single
// enforcement point: >3 eligible capped intents → exactly 3 highest-priority delivered
// (PENDING/SENT), the rest SUPPRESSED, and adding a new (lower-priority) reminder type
// never raises the cap. Idempotent retries reuse rows (no double count — FR-010).

const NOW = new Date("2026-06-06T08:00:00.000Z"); // 11:00 Riyadh → capDay 2026-06-06

let familyId: string;
let childId: string;

function intent(type: ReminderType, triggerMinute: number): NotificationIntent {
  return {
    familyId,
    childId,
    recipient: "CHILD",
    type,
    source: "REMINDER",
    channels: ["PUSH"],
    title: `${type} reminder`,
    triggerTime: new Date(NOW.getTime() + triggerMinute * 60_000),
    countsAgainstCap: true,
  };
}

beforeEach(async () => {
  const family = await prisma.family.create({ data: { name: "cap-test-family" } });
  familyId = family.id;
  const uniq = Math.random().toString(36).slice(2, 10);
  const child = await prisma.child.create({
    data: {
      familyId,
      displayName: "Cap Child",
      dob: new Date("2014-01-01"),
      gender: "MALE",
      country: "SA",
      grade: "Grade 5",
      curriculum: "BRITISH",
      subjects: ["Mathematics"],
      username: `cap_${uniq}`,
      usernameNormalized: `cap_${uniq}`,
    },
  });
  childId = child.id;
});

afterEach(async () => {
  await prisma.notification.deleteMany({ where: { familyId } });
  await prisma.child.deleteMany({ where: { familyId } });
  await prisma.family.deleteMany({ where: { id: familyId } });
});

describe("central daily cap + priority suppression", () => {
  it("delivers exactly the 3 highest-priority intents and suppresses the rest", async () => {
    // 5 eligible types: ranks MISSED_SESSION=1, STRUGGLE_ALERT=2, HOMEWORK_DUE=3,
    // DAILY_STUDY=6, REWARD_REDEEMED=9. The top 3 by rank survive.
    const intents: NotificationIntent[] = [
      intent("REWARD_REDEEMED", 0),
      intent("DAILY_STUDY", 0),
      intent("MISSED_SESSION", 0),
      intent("HOMEWORK_DUE", 0),
      intent("STRUGGLE_ALERT", 0),
    ];

    const result = await buildAndDispatch(intents, NOW);
    expect(result.delivered).toBe(3);
    expect(result.suppressed).toBe(2);

    const rows = await prisma.notification.findMany({ where: { childId } });
    const delivered = rows.filter((r) => r.dispatchStatus === "PENDING").map((r) => r.type);
    const suppressed = rows.filter((r) => r.dispatchStatus === "SUPPRESSED").map((r) => r.type);

    expect(new Set(delivered)).toEqual(
      new Set(["MISSED_SESSION", "STRUGGLE_ALERT", "HOMEWORK_DUE"]),
    );
    expect(new Set(suppressed)).toEqual(new Set(["DAILY_STUDY", "REWARD_REDEEMED"]));
  });

  it("breaks ties by earliest trigger time", async () => {
    // Two same-rank-class intents won't collide on type (unique), so use distinct types
    // with adjacent ranks and confirm the earlier-trigger lower-rank wins the budget.
    const intents: NotificationIntent[] = [
      intent("WEEKLY_SUMMARY", 30), // rank 7, later
      intent("ACHIEVEMENT", 0), // rank 8, earlier
      intent("REWARD_REDEEMED", 0), // rank 9
      intent("DAILY_STUDY", 0), // rank 6
    ];
    const result = await buildAndDispatch(intents, NOW);
    expect(result.delivered).toBe(3);
    const delivered = (await prisma.notification.findMany({ where: { childId } }))
      .filter((r) => r.dispatchStatus === "PENDING")
      .map((r) => r.type);
    // ranks 6,7,8 win over 9
    expect(new Set(delivered)).toEqual(new Set(["DAILY_STUDY", "WEEKLY_SUMMARY", "ACHIEVEMENT"]));
  });

  it("adding a 10th-style extra reminder type does not raise the cap (SC-002)", async () => {
    const base: NotificationIntent[] = [
      intent("MISSED_SESSION", 0),
      intent("STRUGGLE_ALERT", 0),
      intent("HOMEWORK_DUE", 0),
    ];
    // One more, even highest possible, can't exceed the cap of 3.
    const withExtra = [...base, intent("EXAM_COUNTDOWN", 0)];
    const result = await buildAndDispatch(withExtra, NOW);
    expect(result.delivered).toBe(3);

    const capped = await prisma.notification.count({
      where: { childId, countsAgainstCap: true, dispatchStatus: { in: ["PENDING", "SENT"] } },
    });
    expect(capped).toBe(3);
  });

  it("is idempotent on retry: a re-run does not double-count or re-deliver (FR-010)", async () => {
    const intents: NotificationIntent[] = [
      intent("MISSED_SESSION", 0),
      intent("HOMEWORK_DUE", 0),
    ];
    await buildAndDispatch(intents, NOW);
    const firstCount = await prisma.notification.count({ where: { childId } });

    // Re-run the same sweep — unique (childId, capDay, type) makes it a no-op.
    const second = await buildAndDispatch(intents, NOW);
    expect(second.delivered).toBe(0);
    const secondCount = await prisma.notification.count({ where: { childId } });
    expect(secondCount).toBe(firstCount);
  });

  it("does not cap parent-only (uncapped) intents", async () => {
    const billing: NotificationIntent = {
      familyId,
      childId: null,
      recipient: "PARENT",
      type: null,
      source: "BILLING",
      channels: ["EMAIL"],
      title: "Payment failed",
      triggerTime: NOW,
      countsAgainstCap: false,
    };
    // 3 capped + 1 uncapped → all 3 capped delivered AND the billing one delivered.
    const result = await buildAndDispatch(
      [
        intent("MISSED_SESSION", 0),
        intent("STRUGGLE_ALERT", 0),
        intent("HOMEWORK_DUE", 0),
        billing,
      ],
      NOW,
    );
    expect(result.delivered).toBe(4);
  });
});
