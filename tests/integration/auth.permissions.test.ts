import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import prisma from "../../src/db/prisma.js";
import { hashSecret } from "../../src/lib/hashing.js";
import { signAccess } from "../../src/lib/jwt.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";

let app: Application;
let familyAId: string;
let familyBId: string;
let parentAId: string;
let childAId: string;

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

beforeEach(async () => {
  const passwordHash = await hashSecret("ParentPass123!");
  const childPassHash = await hashSecret("ChildPass123!");

  // Family A
  const familyA = await prisma.family.create({ data: { name: "perm-test-family-a" } });
  familyAId = familyA.id;

  const parentA = await prisma.parent.create({
    data: {
      familyId: familyAId,
      role: "OWNER",
      fullName: "Parent A",
      email: "parent.a@test.perm",
      passwordHash,
      dob: new Date("1985-01-01"),
    },
  });
  parentAId = parentA.id;

  const childA = await prisma.child.create({
    data: {
      familyId: familyAId,
      displayName: "Child A",
      dob: new Date("2015-01-01"),
      gender: "MALE",
      country: "US",
      grade: "4",
      curriculum: "AMERICAN",
      subjects: ["Math"],
      username: "childa",
      usernameNormalized: "childa",
      passwordHash: childPassHash,
    },
  });
  childAId = childA.id;

  // Family B
  const familyB = await prisma.family.create({ data: { name: "perm-test-family-b" } });
  familyBId = familyB.id;

  const parentB = await prisma.parent.create({
    data: {
      familyId: familyBId,
      role: "OWNER",
      fullName: "Parent B",
      email: "parent.b@test.perm",
      passwordHash,
      dob: new Date("1985-01-01"),
    },
  });
  void parentB; // familyBId already captured
});

afterEach(async () => {
  await prisma.authSession.updateMany({
    where: { familyId: { in: [familyAId, familyBId] } },
    data: { replacedById: null },
  });
  await prisma.authSession.deleteMany({ where: { familyId: { in: [familyAId, familyBId] } } });
  await prisma.child.deleteMany({ where: { familyId: { in: [familyAId, familyBId] } } });
  await prisma.parent.deleteMany({ where: { familyId: { in: [familyAId, familyBId] } } });
  await prisma.family.deleteMany({ where: { id: { in: [familyAId, familyBId] } } });
});

async function getParentToken(email: string): Promise<string> {
  const res = await request(app)
    .post("/auth/parent/login")
    .send({ email, password: "ParentPass123!" });
  return res.body.data.accessToken as string;
}

async function getChildToken(): Promise<string> {
  const res = await request(app)
    .post("/auth/child/login")
    .send({ username: "childa", password: "ChildPass123!" });
  return res.body.data.accessToken as string;
}

describe("SC-002: Child token rejected on parent endpoints", () => {
  it("GET /auth/me is allowed for child tokens", async () => {
    // /auth/me is accessible to any authenticated principal
    const childToken = await getChildToken();
    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${childToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe("child");
  });

  it("PATCH /parents/children/:id/credentials rejects child tokens with 403", async () => {
    const childToken = await getChildToken();
    const res = await request(app)
      .patch(`/parents/children/${childAId}/credentials`)
      .set("Authorization", `Bearer ${childToken}`)
      .send({ password: "NewPass123!" });
    expect(res.status).toBe(403);
  });

  it("POST /auth/shared/reauth rejects child tokens with 403", async () => {
    const childToken = await getChildToken();
    const res = await request(app)
      .post("/auth/shared/reauth")
      .set("Authorization", `Bearer ${childToken}`)
      .send({ parentId: parentAId, deviceId: "device1", password: "ParentPass123!" });
    expect(res.status).toBe(403);
  });
});

describe("SC-003: Cross-family access denied", () => {
  it("Parent A cannot reset credentials for Child in Family B scope (family scope check)", async () => {
    // Create a child in Family B
    const childPassHash = await hashSecret("ChildPass123!");
    const childB = await prisma.child.create({
      data: {
        familyId: familyBId,
        displayName: "Child B",
        dob: new Date("2015-01-01"),
        gender: "FEMALE",
        country: "US",
        grade: "3",
        curriculum: "AMERICAN",
        subjects: ["Science"],
        username: "childb",
        usernameNormalized: "childb",
        passwordHash: childPassHash,
      },
    });

    const tokenA = await getParentToken("parent.a@test.perm");
    const res = await request(app)
      .patch(`/parents/children/${childB.id}/credentials`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ password: "HackedPass!" });

    expect([403, 404]).toContain(res.status);

    await prisma.child.delete({ where: { id: childB.id } });
  });
});

describe("SC-009: Tampered/expired/revoked credentials rejected", () => {
  it("rejects a tampered access token", async () => {
    const token = await getParentToken("parent.a@test.perm");
    const tampered = token.slice(0, -4) + "XXXX";
    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${tampered}`);
    expect(res.status).toBe(401);
  });

  it("rejects a fabricated token with wrong secret", async () => {
    const fake = signAccess({
      sub: parentAId,
      type: "parent",
      role: "owner",
      familyId: familyAId,
      sid: "fake-session-id",
    });
    // This token is signed with the test JWT_ACCESS_SECRET so it will verify
    // but the session won't exist in the DB → rejected
    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${fake}`);
    expect(res.status).toBe(401);
  });

  it("rejects a request with no token", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
  });
});
