import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import prisma from "../../src/db/prisma.js";
import { hashSecret } from "../../src/lib/hashing.js";
import { createRedisClient, getRedis } from "../../src/db/redis.js";
import config from "../../src/config/index.js";

let app: Application;
let familyId: string;
let parentId: string;

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

beforeEach(async () => {
  const passwordHash = await hashSecret("ParentPass123!");

  const family = await prisma.family.create({ data: { name: "shared-device-test-family" } });
  familyId = family.id;

  const parent = await prisma.parent.create({
    data: {
      familyId,
      role: "OWNER",
      fullName: "Shared Device Parent",
      email: "parent@test.shared",
      passwordHash,
      dob: new Date("1985-05-20"),
    },
  });
  parentId = parent.id;

  await prisma.child.createMany({
    data: [
      {
        familyId,
        displayName: "Picker Child 1",
        dob: new Date("2015-01-01"),
        gender: "MALE",
        country: "US",
        grade: "4",
        curriculum: "AMERICAN",
        subjects: ["Math"],
        username: "picker1",
        usernameNormalized: "picker1",
      },
      {
        familyId,
        displayName: "Picker Child 2",
        dob: new Date("2016-06-15"),
        gender: "FEMALE",
        country: "US",
        grade: "3",
        curriculum: "AMERICAN",
        subjects: ["Science"],
        username: "picker2",
        usernameNormalized: "picker2",
      },
    ],
  });
});

afterEach(async () => {
  await prisma.authSession.updateMany({ where: { familyId }, data: { replacedById: null } });
  await prisma.authSession.deleteMany({ where: { familyId } });
  const parentIds = await prisma.parent
    .findMany({ where: { familyId }, select: { id: true } })
    .then((p) => p.map((x) => x.id));
  if (parentIds.length) {
    await prisma.emailVerificationToken.deleteMany({ where: { parentId: { in: parentIds } } });
  }
  await prisma.child.deleteMany({ where: { familyId } });
  await prisma.parent.deleteMany({ where: { familyId } });
  await prisma.family.delete({ where: { id: familyId } });

  const r = getRedis();
  if (r) {
    try {
      const keys = await r.keys(`reauth:${parentId}:*`);
      if (keys.length) await r.del(...keys);
    } catch {
      // Redis unavailable, skip cleanup
    }
  }
});

describe("GET /auth/shared/children", () => {
  async function parentToken(): Promise<string> {
    const loginRes = await request(app)
      .post("/auth/parent/login")
      .send({ email: "parent@test.shared", password: "ParentPass123!" });
    return loginRes.body.data.accessToken as string;
  }

  it("returns safe child profiles for the principal's family — no secrets", async () => {
    const token = await parentToken();
    const res = await request(app)
      .get("/auth/shared/children")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const children = res.body.data as Array<{
      id: string;
      displayName: string;
      username: string;
      passwordHash?: string;
      pinHash?: string;
    }>;

    expect(children.length).toBe(2);
    for (const child of children) {
      expect(child.passwordHash).toBeUndefined();
      expect(child.pinHash).toBeUndefined();
      expect(child).toHaveProperty("displayName");
      expect(child).toHaveProperty("username");
    }
  });

  it("rejects unauthenticated requests (no family enumeration)", async () => {
    const res = await request(app).get("/auth/shared/children");
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/shared/reauth (SC-006)", () => {
  let parentAccessToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/auth/parent/login")
      .send({ email: "parent@test.shared", password: "ParentPass123!" });
    parentAccessToken = loginRes.body.data.accessToken as string;
  });

  it("SC-006: allows reauth with correct password", async () => {
    const res = await request(app)
      .post("/auth/shared/reauth")
      .set("Authorization", `Bearer ${parentAccessToken}`)
      .send({ deviceId: "device-abc", password: "ParentPass123!" });

    expect(res.status).toBe(200);
  });

  it("SC-006: rejects reauth with wrong password", async () => {
    const res = await request(app)
      .post("/auth/shared/reauth")
      .set("Authorization", `Bearer ${parentAccessToken}`)
      .send({ deviceId: "device-abc", password: "WrongPassword" });

    expect(res.status).toBe(401);
  });

  it("requires a parent token", async () => {
    const res = await request(app)
      .post("/auth/shared/reauth")
      .send({ deviceId: "device-abc", password: "ParentPass123!" });

    expect(res.status).toBe(401);
  });
});
