import { describe, it, expect } from "vitest";
import {
  REMINDER_CATALOG,
  REMINDER_PRIORITY_RANK,
  reminderPriorityRank,
} from "../../src/lib/reminders.js";
import type { ReminderType } from "../../src/generated/prisma/client.js";

// The fixed per-type priority tier (research.md §3, FR-008a). Lower rank = higher
// priority; the dispatcher delivers lowest-rank intents first when over the daily cap.

const EXPECTED: Record<ReminderType, number> = {
  MISSED_SESSION: 1,
  STRUGGLE_ALERT: 2,
  HOMEWORK_DUE: 3,
  EXAM_COUNTDOWN: 4,
  STREAK_PROTECTION: 5,
  DAILY_STUDY: 6,
  WEEKLY_SUMMARY: 7,
  ACHIEVEMENT: 8,
  REWARD_REDEEMED: 9,
};

describe("reminder priority ranks", () => {
  it("assigns the exact fixed rank to each of the 9 types", () => {
    for (const [type, rank] of Object.entries(EXPECTED)) {
      expect(reminderPriorityRank(type as ReminderType)).toBe(rank);
    }
  });

  it("ranks are a strict 1..9 permutation (no ties, no gaps)", () => {
    const ranks = Object.values(REMINDER_PRIORITY_RANK).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("MISSED_SESSION outranks every other type and REWARD_REDEEMED is lowest", () => {
    const ranks = Object.entries(EXPECTED);
    const min = ranks.reduce((a, b) => (a[1] <= b[1] ? a : b))[0];
    const max = ranks.reduce((a, b) => (a[1] >= b[1] ? a : b))[0];
    expect(min).toBe("MISSED_SESSION");
    expect(max).toBe("REWARD_REDEEMED");
  });

  it("the catalog entries carry the same rank as the rank map", () => {
    for (const entry of REMINDER_CATALOG) {
      expect(entry.priorityRank).toBe(REMINDER_PRIORITY_RANK[entry.type]);
    }
  });

  it("sorting a shuffled set of types by rank yields the priority order", () => {
    const shuffled: ReminderType[] = [
      "REWARD_REDEEMED",
      "HOMEWORK_DUE",
      "MISSED_SESSION",
      "DAILY_STUDY",
      "STRUGGLE_ALERT",
    ];
    const ordered = [...shuffled].sort(
      (a, b) => reminderPriorityRank(a) - reminderPriorityRank(b),
    );
    expect(ordered).toEqual([
      "MISSED_SESSION",
      "STRUGGLE_ALERT",
      "HOMEWORK_DUE",
      "DAILY_STUDY",
      "REWARD_REDEEMED",
    ]);
  });
});
