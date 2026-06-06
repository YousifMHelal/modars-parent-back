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
let childId: string;

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

beforeEach(async () => {
  const passwordHash = await hashSecret("ChildPass123!");
  const pinHash = await hashSecret("4321");

  const family = await prisma.family.create({ data: { name: "child-test-family" } });
  familyId = family.id;

  await prisma.parent.create({
    data: {
      familyId,
      role: "OWNER",
      fullName: "Child Test Parent",
      email: "parent@test.child",
      passwordHash: await hashSecret("ParentPass123!"),
      dob: new Date("1985-06-15"),
    },
  });

  const child = await prisma.child.create({
    data: {
      familyId,
      displayName: "Test Child",
      dob: new Date("2015-03-10"),
      gender: "MALE",
      country: "US",
      grade: "5",
      curriculum: "AMERICAN",
      subjects: ["Math"],
      username: "testchild",
      usernameNormalized: "testchild",
      passwordHash,
      pinHash,
    },
  });
  childId = child.id;
});

afterEach(async () => {
  await prisma.authSession.updateMany({ where: { familyId }, data: { replacedById: null } });
  await prisma.authSession.deleteMany({ where: { familyId } });
  await prisma.child.deleteMany({ where: { familyId } });
  await prisma.emailVerificationToken.deleteMany({
    where: {
      parentId: {
        in: await prisma.parent
          .findMany({ where: { familyId }, select: { id: true } })
          .then((p) => p.map((x) => x.id)),
      },
    },
  });
  await prisma.parent.deleteMany({ where: { familyId } });
  await prisma.family.delete({ where: { id: familyId } });

  const r = getRedis();
  if (r) {
    try {
      const keys = await r.keys("lockout:*testchild*");
      if (keys.length) await r.del(...keys);
      const childKeys = await r.keys(`lockout:child:${childId}`);
      if (childKeys.length) await r.del(...childKeys);
    } catch {
      // Redis unavailable, skip cleanup
    }
  }
});

describe("POST /auth/child/login", () => {
  it("SC-001 child half: logs in with username+password", async () => {
    const res = await request(app)
      .post("/auth/child/login")
      .send({ username: "testchild", password: "ChildPass123!" });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("accessToken");
    expect(res.body.data).toHaveProperty("refreshToken");
  });

  it("SC-001 child half: logs in with PIN", async () => {
    const res = await request(app)
      .post("/auth/child/login")
      .send({ username: "testchild", pin: "4321" });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("accessToken");
    expect(res.body.data).toHaveProperty("refreshToken");
  });

  it("child token carries role: child", async () => {
    const res = await request(app)
      .post("/auth/child/login")
      .send({ username: "testchild", password: "ChildPass123!" });

    const jwt = await import("jsonwebtoken");
    const claims = jwt.default.decode(res.body.data.accessToken as string) as {
      role: string;
      type: string;
      familyId: string;
    };
    expect(claims.role).toBe("child");
    expect(claims.type).toBe("child");
    expect(claims.familyId).toBe(familyId);
  });

  it("returns 401 on wrong password", async () => {
    const res = await request(app)
      .post("/auth/child/login")
      .send({ username: "testchild", password: "WrongPassword" });
    expect(res.status).toBe(401);
  });

  it("returns 401 on wrong PIN", async () => {
    const res = await request(app)
      .post("/auth/child/login")
      .send({ username: "testchild", pin: "9999" });
    expect(res.status).toBe(401);
  });

  it("returns 401 on unknown username", async () => {
    const res = await request(app)
      .post("/auth/child/login")
      .send({ username: "unknownkid", password: "anything" });
    expect(res.status).toBe(401);
  });

  it("SC-007: locks after 5 wrong credentials", async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/auth/child/login")
        .send({ username: "testchild", password: "wrong" });
    }
    const res = await request(app)
      .post("/auth/child/login")
      .send({ username: "testchild", password: "ChildPass123!" });
    expect(res.status).toBe(429);
  }, 60_000);
});

describe("PATCH /parents/children/:childId/credentials (SC-005)", () => {
  let parentAccessToken: string;

  beforeEach(async () => {
    // Get a parent token by calling login
    const loginRes = await request(app)
      .post("/auth/parent/login")
      .send({ email: "parent@test.child", password: "ParentPass123!" });
    parentAccessToken = loginRes.body.data.accessToken as string;
  });

  it("resets child password and revokes existing sessions", async () => {
    // Establish a child session
    const childLogin = await request(app)
      .post("/auth/child/login")
      .send({ username: "testchild", password: "ChildPass123!" });
    const childRefresh = childLogin.body.data.refreshToken as string;

    // Parent resets password
    const resetRes = await request(app)
      .patch(`/parents/children/${childId}/credentials`)
      .set("Authorization", `Bearer ${parentAccessToken}`)
      .send({ password: "NewChildPass456!" });

    expect(resetRes.status).toBe(204);

    // Old child refresh token should now be revoked
    const refreshRes = await request(app)
      .post("/auth/refresh")
      .send({ refreshToken: childRefresh });
    expect(refreshRes.status).toBe(401);
  });

  it("returns 409 on username conflict", async () => {
    // Create another child with the target username
    await prisma.child.create({
      data: {
        familyId,
        displayName: "Another Child",
        dob: new Date("2016-05-20"),
        gender: "FEMALE",
        country: "US",
        grade: "4",
        curriculum: "AMERICAN",
        subjects: ["Science"],
        username: "takenuser",
        usernameNormalized: "takenuser",
      },
    });

    const res = await request(app)
      .patch(`/parents/children/${childId}/credentials`)
      .set("Authorization", `Bearer ${parentAccessToken}`)
      .send({ username: "takenuser" });

    expect(res.status).toBe(409);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app)
      .patch(`/parents/children/${childId}/credentials`)
      .send({ password: "NewPass!" });
    expect(res.status).toBe(401);
  });
});
