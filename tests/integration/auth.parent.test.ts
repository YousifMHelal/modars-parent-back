import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import prisma from "../../src/db/prisma.js";
import { getRedis, createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";

let app: Application;

async function cleanTestParents() {
  const parents = await prisma.parent.findMany({
    where: { email: { contains: "@test.parent" } },
    select: { id: true },
  });
  const parentIds = parents.map((p) => p.id);
  if (parentIds.length) {
    await prisma.emailVerificationToken.deleteMany({ where: { parentId: { in: parentIds } } });
    await prisma.authSession.updateMany({
      where: { parentId: { in: parentIds } },
      data: { replacedById: null },
    });
    await prisma.authSession.deleteMany({ where: { parentId: { in: parentIds } } });
    await prisma.oAuthAccount.deleteMany({ where: { parentId: { in: parentIds } } });
    await prisma.parent.deleteMany({ where: { id: { in: parentIds } } });
  }
  await prisma.family.deleteMany({ where: { name: { contains: "test-parent-family" } } });
}

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

beforeEach(async () => {
  await cleanTestParents();
  const r = getRedis();
  if (r) {
    try {
      const keys = await r.keys("lockout:*test.parent*");
      if (keys.length) await r.del(...keys);
    } catch {
      /* Redis unavailable */
    }
  }
});

afterEach(async () => {
  await cleanTestParents();
});

const VALID_PARENT = {
  familyName: "test-parent-family",
  fullName: "Test Parent",
  email: "owner@test.parent",
  password: "SecurePassword123!",
  dob: "1990-01-15",
};

describe("POST /auth/parent/register", () => {
  it("SC-001 parent half: registers and returns tokens", async () => {
    const res = await request(app).post("/auth/parent/register").send(VALID_PARENT);

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty("accessToken");
    expect(res.body.data).toHaveProperty("refreshToken");
  });

  it("SC-004: rejects under-18 DOB with 422", async () => {
    const res = await request(app)
      .post("/auth/parent/register")
      .send({ ...VALID_PARENT, email: "young@test.parent", dob: "2010-01-01" });

    expect(res.status).toBe(422);
  });

  it("returns 409 on duplicate email", async () => {
    await request(app).post("/auth/parent/register").send(VALID_PARENT);
    const res = await request(app).post("/auth/parent/register").send(VALID_PARENT);
    expect(res.status).toBe(409);
  });

  it("returns 400 on invalid body", async () => {
    const res = await request(app)
      .post("/auth/parent/register")
      .send({ email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
  });
});

describe("POST /auth/parent/login", () => {
  beforeEach(async () => {
    await request(app).post("/auth/parent/register").send(VALID_PARENT);
  });

  it("SC-001 parent half: logs in successfully", async () => {
    const res = await request(app)
      .post("/auth/parent/login")
      .send({ email: VALID_PARENT.email, password: VALID_PARENT.password });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("accessToken");
    expect(res.body.data).toHaveProperty("refreshToken");
  });

  it("returns 401 on wrong password", async () => {
    const res = await request(app)
      .post("/auth/parent/login")
      .send({ email: VALID_PARENT.email, password: "WrongPassword" });
    expect(res.status).toBe(401);
  });

  it("returns 401 on non-existent email", async () => {
    const res = await request(app)
      .post("/auth/parent/login")
      .send({ email: "ghost@test.parent", password: "anything" });
    expect(res.status).toBe(401);
  });

  it("SC-007: locks after 5 consecutive failures", async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/auth/parent/login")
        .send({ email: VALID_PARENT.email, password: "wrong" });
    }
    const res = await request(app)
      .post("/auth/parent/login")
      .send({ email: VALID_PARENT.email, password: VALID_PARENT.password });
    expect(res.status).toBe(429);
  }, 60_000);
});

describe("POST /auth/refresh (SC-008)", () => {
  it("rotates the refresh token on use", async () => {
    const reg = await request(app)
      .post("/auth/parent/register")
      .send({ ...VALID_PARENT, email: "refresh1@test.parent" });
    expect(reg.status).toBe(201);
    const { refreshToken } = reg.body.data as { refreshToken: string; accessToken: string };

    const res = await request(app).post("/auth/refresh").send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).not.toBe(refreshToken);
    expect(res.body.data).toHaveProperty("accessToken");
  });

  it("SC-008: replay of a rotated token revokes session (returns 401)", async () => {
    const reg = await request(app)
      .post("/auth/parent/register")
      .send({ ...VALID_PARENT, email: "replay@test.parent" });
    expect(reg.status).toBe(201);
    const { refreshToken } = reg.body.data as { refreshToken: string };

    // Rotate once
    await request(app).post("/auth/refresh").send({ refreshToken });

    // Present the original (now stale) token again
    const res = await request(app).post("/auth/refresh").send({ refreshToken });
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/logout", () => {
  it("logs out and rejects subsequent use of the session", async () => {
    const reg = await request(app)
      .post("/auth/parent/register")
      .send({ ...VALID_PARENT, email: "logout@test.parent" });
    expect(reg.status).toBe(201);
    const { accessToken, refreshToken } = reg.body.data as {
      accessToken: string;
      refreshToken: string;
    };

    const logoutRes = await request(app)
      .post("/auth/logout")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(logoutRes.status).toBe(204);

    const refreshRes = await request(app).post("/auth/refresh").send({ refreshToken });
    expect(refreshRes.status).toBe(401);
  });
});

describe("GET /auth/me", () => {
  it("returns the current principal", async () => {
    const reg = await request(app)
      .post("/auth/parent/register")
      .send({ ...VALID_PARENT, email: "me@test.parent" });
    expect(reg.status).toBe(201);
    const { accessToken } = reg.body.data as { accessToken: string };

    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("me@test.parent");
    expect(res.body.data.type).toBe("parent");
  });

  it("returns 401 without a token", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("GET /auth/email/verify (SC-010)", () => {
  it("verifies a valid token — non-blocking registration, invalid token rejected", async () => {
    const email = "verify@test.parent";
    const reg = await request(app)
      .post("/auth/parent/register")
      .send({ ...VALID_PARENT, email });
    expect(reg.status).toBe(201);

    const parent = await prisma.parent.findUniqueOrThrow({ where: { email } });
    expect(parent.emailVerifiedAt).toBeNull(); // Non-blocking: usable immediately

    const tokenRecord = await prisma.emailVerificationToken.findFirstOrThrow({
      where: { parentId: parent.id },
    });
    expect(tokenRecord.consumedAt).toBeNull();

    // Invalid token is rejected
    const res = await request(app).get("/auth/email/verify").query({ token: "invalid-token" });
    expect(res.status).toBe(400);
  });

  it("verifies the parent with a valid token and consumes it", async () => {
    const email = "verify-ok@test.parent";
    const reg = await request(app)
      .post("/auth/parent/register")
      .send({ ...VALID_PARENT, email });
    expect(reg.status).toBe(201);

    const parent = await prisma.parent.findUniqueOrThrow({ where: { email } });

    // Reconstruct the raw token the mailer would have sent: the DB stores only
    // its sha256, so generate a token, store its hash, and verify with the raw.
    const crypto = await import("node:crypto");
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await prisma.emailVerificationToken.updateMany({
      where: { parentId: parent.id, consumedAt: null },
      data: { tokenHash },
    });

    const res = await request(app).get("/auth/email/verify").query({ token: rawToken });
    expect(res.status).toBe(200);

    const after = await prisma.parent.findUniqueOrThrow({ where: { email } });
    expect(after.emailVerifiedAt).not.toBeNull();

    const consumed = await prisma.emailVerificationToken.findFirstOrThrow({
      where: { parentId: parent.id },
    });
    expect(consumed.consumedAt).not.toBeNull();
  });
});
