import { describe, it, expect, beforeAll, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import prisma from "../../src/db/prisma.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import * as authService from "../../src/modules/auth/auth.service.js";

let app: Application;

async function cleanOAuthTestData() {
  // Find all parents with placeholder or test emails
  const parents = await prisma.parent.findMany({
    where: {
      OR: [{ email: { contains: "@placeholder.invalid" } }, { email: { contains: "@oauth.test" } }],
    },
    select: { id: true, familyId: true },
  });

  const parentIds = parents.map((p) => p.id);
  const familyIds = parents.map((p) => p.familyId);

  if (parentIds.length) {
    await prisma.oAuthAccount.deleteMany({ where: { parentId: { in: parentIds } } });
    await prisma.authSession.updateMany({
      where: { parentId: { in: parentIds } },
      data: { replacedById: null },
    });
    await prisma.authSession.deleteMany({ where: { parentId: { in: parentIds } } });
    await prisma.parent.deleteMany({ where: { id: { in: parentIds } } });
  }

  if (familyIds.length) {
    await prisma.family.deleteMany({ where: { id: { in: familyIds } } });
  }
}

beforeAll(async () => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
  // Clean any leftover data from previous runs
  await cleanOAuthTestData();
});

afterEach(async () => {
  await cleanOAuthTestData();
});

describe("OAuth flows (service-level, no real provider)", () => {
  it("first-time OAuth returns needs_dob status", async () => {
    const result = await authService.findOrCreateByOAuth({
      provider: "GOOGLE",
      providerAccountId: "test-oauth-001",
      email: "new@oauth.test",
      name: "OAuth User",
    });

    expect(result.status).toBe("needs_dob");
    expect("dobToken" in result).toBe(true);
  });

  it("subsequent OAuth with same identity returns a session", async () => {
    const first = await authService.findOrCreateByOAuth({
      provider: "GOOGLE",
      providerAccountId: "test-oauth-002",
      email: "returning@oauth.test",
      name: "Returning OAuth",
    });

    expect(first.status).toBe("needs_dob");
    const dobToken = (first as { status: "needs_dob"; dobToken: string }).dobToken;

    await authService.completeOAuthDob(dobToken, new Date("1992-07-20"));

    const second = await authService.findOrCreateByOAuth({
      provider: "GOOGLE",
      providerAccountId: "test-oauth-002",
      email: "returning@oauth.test",
      name: "Returning OAuth",
    });

    expect(second.status).toBe("session");
    expect("tokens" in second).toBe(true);
  });

  it("completeOAuthDob rejects under-18 DOB", async () => {
    const first = await authService.findOrCreateByOAuth({
      provider: "GOOGLE",
      providerAccountId: "test-oauth-003",
      email: "young@oauth.test",
      name: undefined,
    });

    const dobToken = (first as { status: "needs_dob"; dobToken: string }).dobToken;

    await expect(authService.completeOAuthDob(dobToken, new Date("2010-01-01"))).rejects.toThrow();
  });

  it("POST /auth/oauth/complete-dob returns 200 with valid DOB", async () => {
    const first = await authService.findOrCreateByOAuth({
      provider: "GOOGLE",
      providerAccountId: "test-oauth-004",
      email: "dob@oauth.test",
      name: undefined,
    });

    const dobToken = (first as { status: "needs_dob"; dobToken: string }).dobToken;

    const res = await request(app)
      .post("/auth/oauth/complete-dob")
      .send({ dobToken, dob: "1990-05-15" });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("accessToken");
  });

  it("POST /auth/oauth/complete-dob returns 422 with under-18 DOB", async () => {
    const first = await authService.findOrCreateByOAuth({
      provider: "GOOGLE",
      providerAccountId: "test-oauth-005",
      email: "tooyoung@oauth.test",
      name: undefined,
    });

    const dobToken = (first as { status: "needs_dob"; dobToken: string }).dobToken;

    const res = await request(app)
      .post("/auth/oauth/complete-dob")
      .send({ dobToken, dob: "2015-01-01" });

    expect(res.status).toBe(422);
  });

  it("POST /auth/oauth/complete-dob rejects a forged/invalid token", async () => {
    const res = await request(app)
      .post("/auth/oauth/complete-dob")
      .send({ dobToken: "not-a-real-token", dob: "1990-05-15" });

    expect(res.status).toBe(401);
  });

  it("GET /auth/oauth/:provider/start returns 501 when not configured", async () => {
    const res = await request(app).get("/auth/oauth/google/start");
    expect(res.status).toBe(501);
  });

  it("GET /auth/oauth/:provider/callback returns 501 when not configured", async () => {
    const res = await request(app).get("/auth/oauth/google/callback");
    expect(res.status).toBe(501);
  });
});
