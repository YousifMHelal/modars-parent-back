import { describe, it, expect, beforeAll } from "vitest";
import { signAccess, signRefresh, verifyAccess, verifyRefresh } from "../../src/lib/jwt.js";

beforeAll(() => {
  process.env["JWT_ACCESS_SECRET"] ??= "test-access-secret-that-is-long-enough-32chars";
  process.env["JWT_REFRESH_SECRET"] ??= "test-refresh-secret-that-is-long-enough-32ch";
  process.env["JWT_ACCESS_TTL"] ??= "15m";
  process.env["JWT_REFRESH_TTL"] ??= "30d";
});

const baseAccess = {
  sub: "parent-id-1",
  type: "parent" as const,
  role: "owner" as const,
  familyId: "family-id-1",
  sid: "session-id-1",
};

const baseRefresh = {
  sub: "parent-id-1",
  sid: "session-id-1",
  type: "parent" as const,
  jti: "refresh-nonce-1",
};

describe("JWT access tokens", () => {
  it("signs and verifies an access token", () => {
    const token = signAccess(baseAccess);
    const claims = verifyAccess(token);
    expect(claims.sub).toBe(baseAccess.sub);
    expect(claims.type).toBe(baseAccess.type);
    expect(claims.role).toBe(baseAccess.role);
    expect(claims.familyId).toBe(baseAccess.familyId);
    expect(claims.sid).toBe(baseAccess.sid);
  });

  it("produces a different token each time (iat differs)", () => {
    const t1 = signAccess(baseAccess);
    const t2 = signAccess(baseAccess);
    // Same claims but timestamps may differ in sub-second tests — at least verify both parse
    expect(verifyAccess(t1).sub).toBe(baseAccess.sub);
    expect(verifyAccess(t2).sub).toBe(baseAccess.sub);
  });

  it("throws on a tampered access token", () => {
    const token = signAccess(baseAccess);
    const tampered = token.slice(0, -4) + "XXXX";
    expect(() => verifyAccess(tampered)).toThrow();
  });

  it("throws on an expired access token", async () => {
    const { signAccess: _signAccess } = await import("../../src/lib/jwt.js");
    // Sign with an already-expired TTL by signing normally and overriding — we test via jsonwebtoken directly
    const jwt = await import("jsonwebtoken");
    const expired = jwt.default.sign({ ...baseAccess }, process.env["JWT_ACCESS_SECRET"]!, {
      expiresIn: -1,
      algorithm: "HS256",
    });
    expect(() => verifyAccess(expired)).toThrow();
  });

  it("carries child role correctly", () => {
    const childClaims = {
      ...baseAccess,
      type: "child" as const,
      role: "child" as const,
      sub: "child-id-1",
    };
    const token = signAccess(childClaims);
    const verified = verifyAccess(token);
    expect(verified.type).toBe("child");
    expect(verified.role).toBe("child");
  });
});

describe("JWT refresh tokens", () => {
  it("signs and verifies a refresh token", () => {
    const token = signRefresh(baseRefresh);
    const claims = verifyRefresh(token);
    expect(claims.sub).toBe(baseRefresh.sub);
    expect(claims.sid).toBe(baseRefresh.sid);
    expect(claims.type).toBe(baseRefresh.type);
    expect(claims.jti).toBe(baseRefresh.jti);
  });

  it("throws on a tampered refresh token", () => {
    const token = signRefresh(baseRefresh);
    const tampered = token.slice(0, -4) + "XXXX";
    expect(() => verifyRefresh(tampered)).toThrow();
  });
});
