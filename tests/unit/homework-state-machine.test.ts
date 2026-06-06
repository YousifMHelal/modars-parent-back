import { describe, it, expect } from "vitest";
import { transition } from "../../src/modules/homework/homework.service.js";

// Pure homework transition function (FR-015/016/018, SC-004). Covers every path incl.
// the deadline==completion boundary and out-of-order / terminal-state no-ops.

const deadline = new Date("2026-06-10T12:00:00.000Z");
const before = new Date("2026-06-09T12:00:00.000Z");
const after = new Date("2026-06-11T12:00:00.000Z");
const exactly = new Date("2026-06-10T12:00:00.000Z");

describe("homework transition", () => {
  it("PENDING + started → IN_PROGRESS", () => {
    expect(transition("PENDING", "started", deadline, before)).toBe("IN_PROGRESS");
  });

  it("PENDING + completed before deadline → COMPLETED", () => {
    expect(transition("PENDING", "completed", deadline, before)).toBe("COMPLETED");
  });

  it("IN_PROGRESS + completed before deadline → COMPLETED", () => {
    expect(transition("IN_PROGRESS", "completed", deadline, before)).toBe("COMPLETED");
  });

  it("completion exactly at the deadline counts as on time (COMPLETED)", () => {
    expect(transition("IN_PROGRESS", "completed", deadline, exactly)).toBe("COMPLETED");
  });

  it("completion after the deadline → COMPLETED_LATE", () => {
    expect(transition("IN_PROGRESS", "completed", deadline, after)).toBe("COMPLETED_LATE");
  });

  it("OVERDUE + completed (even before-ish) → COMPLETED_LATE", () => {
    expect(transition("OVERDUE", "completed", deadline, before)).toBe("COMPLETED_LATE");
  });

  it("out-of-order: started on a COMPLETED item does not regress (no-op)", () => {
    expect(transition("COMPLETED", "started", deadline, after)).toBeNull();
  });

  it("started on an IN_PROGRESS item is a no-op", () => {
    expect(transition("IN_PROGRESS", "started", deadline, before)).toBeNull();
  });

  it("terminal COMPLETED_LATE never changes", () => {
    expect(transition("COMPLETED_LATE", "completed", deadline, before)).toBeNull();
    expect(transition("COMPLETED_LATE", "started", deadline, before)).toBeNull();
  });
});
