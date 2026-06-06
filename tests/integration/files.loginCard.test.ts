import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import prisma from "../../src/db/prisma.js";
import {
  setupWriteFixture,
  teardownWriteFixture,
  mintOwnerToken,
  mintFamilyBOwnerToken,
  type WriteFixture,
} from "./write-fixtures.js";

let app: Application;
let fx: WriteFixture;

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

beforeEach(async () => {
  fx = await setupWriteFixture("FAMILY");
});

afterEach(async () => {
  await teardownWriteFixture();
});

function newChildBody() {
  const uniq = Math.random().toString(36).slice(2, 7);
  return {
    displayName: "Card Kid",
    dateOfBirth: "2015-03-03",
    gender: "MALE",
    country: "SA",
    grade: "Grade 4",
    curriculum: "BRITISH",
    subjects: ["Mathematics"],
    username: `cardkid_${uniq}`,
    password: "kidpass1",
  };
}

describe("GET /files/login-cards/:childId (US3)", () => {
  it("serves the login card to the owning family (200 bytes on local backend)", async () => {
    const token = await mintOwnerToken(fx);
    // Create via the real flow so the login card is backfilled to storage + DB ref.
    const created = await request(app)
      .post("/children")
      .set("Authorization", `Bearer ${token}`)
      .send(newChildBody());
    expect(created.status).toBe(201);

    const stored = await prisma.child.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.loginCardUrl).toBe(`/files/login-cards/${created.body.id}`);

    const res = await request(app)
      .get(`/files/login-cards/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
  });

  it("rejects a request with no token → 401", async () => {
    const res = await request(app).get(`/files/login-cards/${fx.childId}`);
    expect(res.status).toBe(401);
  });

  it("denies a foreign-family parent → 403", async () => {
    const ownerToken = await mintOwnerToken(fx);
    const created = await request(app)
      .post("/children")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send(newChildBody());
    expect(created.status).toBe(201);

    const foreignToken = await mintFamilyBOwnerToken(fx);
    const res = await request(app)
      .get(`/files/login-cards/${created.body.id}`)
      .set("Authorization", `Bearer ${foreignToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 404 for an in-family child that has no login card", async () => {
    // The default fixture child is created directly (no backfill) → loginCardUrl null.
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .get(`/files/login-cards/${fx.childId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
