import { describe, it, expect } from "vitest";
import {
  buildIntentsForReminder,
  evaluateChild,
} from "../../src/modules/reminders/reminders.service.js";

// Recipient addressing (SC-003, FR-005/009): a reminder's recipient (Child/Parent/Both)
// expands to one intent per side, on the right channels; child-addressed reminders count
// against the cap while parent-addressed ones do not.

const base = { familyId: "fam_1", childId: "chd_1" };
const now = new Date("2026-06-06T08:00:00.000Z");

describe("buildIntentsForReminder recipient mapping", () => {
  it("CHILD → one child-addressed, cap-counting intent", () => {
    const intents = buildIntentsForReminder({ ...base, type: "DAILY_STUDY", recipient: "CHILD" }, now);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      recipient: "CHILD",
      childId: "chd_1",
      countsAgainstCap: true,
    });
    expect(intents[0]!.channels).toContain("PUSH");
  });

  it("PARENT → one parent-addressed intent that does NOT count against the cap", () => {
    const intents = buildIntentsForReminder(
      { ...base, type: "MISSED_SESSION", recipient: "PARENT" },
      now,
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ recipient: "PARENT", countsAgainstCap: false });
    expect(intents[0]!.channels).toEqual(expect.arrayContaining(["PUSH", "EMAIL"]));
  });

  it("BOTH → a child (capped) and a parent (uncapped) intent", () => {
    const intents = buildIntentsForReminder({ ...base, type: "HOMEWORK_DUE", recipient: "BOTH" }, now);
    expect(intents).toHaveLength(2);
    const child = intents.find((i) => i.recipient === "CHILD");
    const parent = intents.find((i) => i.recipient === "PARENT");
    expect(child?.countsAgainstCap).toBe(true);
    expect(parent?.countsAgainstCap).toBe(false);
  });
});

describe("evaluateChild status gating (FR-009)", () => {
  const configs = [
    { ...base, type: "DAILY_STUDY" as const, enabled: true, recipient: "BOTH" as const },
  ];

  it("an active child gets both child and parent intents", () => {
    const intents = evaluateChild(
      { id: "chd_1", familyId: "fam_1", status: "ACTIVE", deletedAt: null },
      configs,
      now,
    );
    expect(intents.map((i) => i.recipient).sort()).toEqual(["CHILD", "PARENT"]);
  });

  it("a paused child gets NO child-addressed reminder, but the parent intent remains", () => {
    const intents = evaluateChild(
      { id: "chd_1", familyId: "fam_1", status: "PAUSED", deletedAt: null },
      configs,
      now,
    );
    expect(intents.map((i) => i.recipient)).toEqual(["PARENT"]);
  });

  it("a pending-purge (soft-deleted) child gets no child-addressed reminder", () => {
    const intents = evaluateChild(
      { id: "chd_1", familyId: "fam_1", status: "ACTIVE", deletedAt: new Date() },
      configs,
      now,
    );
    expect(intents.every((i) => i.recipient !== "CHILD")).toBe(true);
  });

  it("disabled reminders produce no intents", () => {
    const intents = evaluateChild(
      { id: "chd_1", familyId: "fam_1", status: "ACTIVE", deletedAt: null },
      [{ ...base, type: "DAILY_STUDY", enabled: false, recipient: "BOTH" }],
      now,
    );
    expect(intents).toHaveLength(0);
  });
});
