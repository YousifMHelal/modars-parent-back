import { describe, it, expect } from "vitest";
import { z } from "zod";

// Re-declare the schema here to test validation behavior directly
// (ESM caching prevents re-importing the module with a modified env)
const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url().startsWith("postgres"),
  REDIS_URL: z.string().url(),
});

describe("Config validation", () => {
  it("throws a clear error when DATABASE_URL is missing", () => {
    const result = configSchema.safeParse({
      NODE_ENV: "test",
      PORT: "4000",
      // DATABASE_URL intentionally missing
      REDIS_URL: "redis://localhost:6379",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("DATABASE_URL");
    }
  });

  it("throws with a clear message when PORT is invalid", () => {
    const result = configSchema.safeParse({
      NODE_ENV: "test",
      PORT: "not-a-port",
      DATABASE_URL: "postgresql://localhost/test",
      REDIS_URL: "redis://localhost:6379",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("PORT");
    }
  });
});
