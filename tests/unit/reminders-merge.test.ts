import { describe, it, expect } from "vitest";
import type { ReminderConfig } from "@prisma/client";
import { REMINDER_CATALOG, mergeFamilyReminderConfigs } from "../../src/lib/reminders.js";

type Row = Pick<ReminderConfig, "type" | "enabled" | "recipient" | "settings">;

describe("mergeFamilyReminderConfigs", () => {
  it("emits all 9 catalog types in order even with no rows", () => {
    const result = mergeFamilyReminderConfigs([]);
    expect(result).toHaveLength(9);
    expect(result.map((r) => r.id)).toEqual(REMINDER_CATALOG.map((c) => c.id));
  });

  it("uses catalog defaults (recipient, hasSettings, description) when no rows exist", () => {
    const result = mergeFamilyReminderConfigs([]);
    const daily = result.find((r) => r.id === "daily-study")!;
    expect(daily.type).toBe("Daily Study Reminder");
    expect(daily.recipient).toBe("Child");
    expect(daily.hasSettings).toBe(true);
    expect(daily.description).toBe("Reminds your child to start their learning session");
    expect(daily.enabled).toBe(false);
    expect(daily.settings).toBeUndefined();
  });

  it("enabled = OR across children for a type", () => {
    const rows: Row[] = [
      { type: "DAILY_STUDY", enabled: false, recipient: "CHILD", settings: null },
      { type: "DAILY_STUDY", enabled: true, recipient: "CHILD", settings: null },
    ];
    const daily = mergeFamilyReminderConfigs(rows).find((r) => r.id === "daily-study")!;
    expect(daily.enabled).toBe(true);
  });

  it("all-disabled rows for a type stay disabled", () => {
    const rows: Row[] = [
      { type: "MISSED_SESSION", enabled: false, recipient: "PARENT", settings: null },
      { type: "MISSED_SESSION", enabled: false, recipient: "PARENT", settings: null },
    ];
    const missed = mergeFamilyReminderConfigs(rows).find((r) => r.id === "missed-session")!;
    expect(missed.enabled).toBe(false);
  });

  it("takes representative recipient + settings from a present row", () => {
    const rows: Row[] = [
      {
        type: "DAILY_STUDY",
        enabled: true,
        recipient: "BOTH",
        settings: { time: "17:00", days: ["Mon", "Tue"] },
      },
    ];
    const daily = mergeFamilyReminderConfigs(rows).find((r) => r.id === "daily-study")!;
    expect(daily.recipient).toBe("Both");
    expect(daily.settings).toEqual({ time: "17:00", days: ["Mon", "Tue"] });
  });

  it("title-cases each recipient enum", () => {
    const rows: Row[] = [
      { type: "DAILY_STUDY", enabled: true, recipient: "CHILD", settings: null },
      { type: "HOMEWORK_DUE", enabled: true, recipient: "BOTH", settings: null },
      { type: "WEEKLY_SUMMARY", enabled: true, recipient: "PARENT", settings: null },
    ];
    const merged = mergeFamilyReminderConfigs(rows);
    expect(merged.find((r) => r.id === "daily-study")!.recipient).toBe("Child");
    expect(merged.find((r) => r.id === "homework-due")!.recipient).toBe("Both");
    expect(merged.find((r) => r.id === "weekly-summary")!.recipient).toBe("Parent");
  });
});
