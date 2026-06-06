import { describe, it, expect } from "vitest";
import { suggestUsername, alternatives, isValidUsername } from "../../src/lib/username.js";

describe("suggestUsername", () => {
  it("lowercases, replaces spaces with underscore, and appends the year", () => {
    expect(suggestUsername("John Doe", 2026)).toBe("john_doe_2026");
  });

  it("strips characters outside [a-z0-9_]", () => {
    expect(suggestUsername("Émile O'Brien!", 2026)).toBe("mile_obrien_2026");
  });

  it("falls back to a safe base when the name has no usable chars", () => {
    expect(suggestUsername("!!!", 2026)).toBe("user_2026");
  });

  it("produces a username within the 20-char limit", () => {
    const result = suggestUsername("A Very Long Display Name Here", 2026);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(isValidUsername(result)).toBe(true);
  });
});

describe("alternatives", () => {
  it("yields at least 3 available, valid candidates", async () => {
    const taken = new Set(["john_doe1"]);
    const isTaken = async (c: string) => taken.has(c);
    const result = await alternatives("john_doe", isTaken, 3);

    expect(result.length).toBeGreaterThanOrEqual(3);
    for (const candidate of result) {
      expect(isValidUsername(candidate)).toBe(true);
      expect(taken.has(candidate)).toBe(false);
    }
    // The taken candidate must be skipped.
    expect(result).not.toContain("john_doe1");
  });

  it("keeps every candidate within the username format", async () => {
    const isTaken = async () => false;
    const result = await alternatives("kid", isTaken, 5);
    expect(result.length).toBeGreaterThanOrEqual(5);
    for (const c of result) expect(isValidUsername(c)).toBe(true);
  });
});
