import { describe, it, expect } from "vitest";
import { hashSecret, verifySecret, dummyVerify } from "../../src/lib/hashing.js";

describe("argon2 hashing", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashSecret("my-secure-password");
    expect(typeof hash).toBe("string");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifySecret(hash, "my-secure-password")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashSecret("correct-horse-battery-staple");
    expect(await verifySecret(hash, "wrong-password")).toBe(false);
  });

  it("hashes a 4-digit PIN", async () => {
    const hash = await hashSecret("1234");
    expect(await verifySecret(hash, "1234")).toBe(true);
    expect(await verifySecret(hash, "4321")).toBe(false);
  });

  it("produces different hashes for the same input (salt)", async () => {
    const h1 = await hashSecret("same-secret");
    const h2 = await hashSecret("same-secret");
    expect(h1).not.toBe(h2);
  });

  it("dummyVerify always returns false without throwing", async () => {
    const result = await dummyVerify();
    expect(result).toBe(false);
  });

  it("dummyVerify takes a comparable duration to a real verify (anti-enumeration)", async () => {
    const hash = await hashSecret("test");
    const start1 = Date.now();
    await verifySecret(hash, "test");
    const real = Date.now() - start1;

    const start2 = Date.now();
    await dummyVerify();
    const dummy = Date.now() - start2;

    // Both should be in the argon2 cost range (roughly similar magnitude)
    // We just verify dummy is not instantaneous (< 5ms would indicate a bypass)
    expect(dummy).toBeGreaterThan(5);
    // Real verify also should take meaningful time
    expect(real).toBeGreaterThan(5);
  }, 10_000);
});
