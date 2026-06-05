import { describe, it, expect } from "vitest";

describe("Config validation", () => {
  it("throws a clear error when DATABASE_URL is missing", async () => {
    const original = process.env["DATABASE_URL"];
    delete process.env["DATABASE_URL"];

    // Dynamic import with query string is a vitest cache-busting pattern — TypeScript
    // doesn't resolve query-string module specifiers, so we suppress the type error.
    // @ts-expect-error vitest query-string cache-bust import
    await expect(import("../../src/config/index.js?bust=1")).rejects.toThrow(
      /DATABASE_URL/,
    );

    if (original !== undefined) {
      process.env["DATABASE_URL"] = original;
    }
  });

  it("throws with a clear message when PORT is invalid", async () => {
    const original = process.env["PORT"];
    process.env["PORT"] = "not-a-port";

    // @ts-expect-error vitest query-string cache-bust import
    await expect(import("../../src/config/index.js?bust=2")).rejects.toThrow(
      /PORT/,
    );

    if (original !== undefined) {
      process.env["PORT"] = original;
    } else {
      delete process.env["PORT"];
    }
  });
});
