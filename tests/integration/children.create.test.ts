import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import prisma from "../../src/db/prisma.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import {
  setupWriteFixture,
  teardownWriteFixture,
  mintOwnerToken,
  type WriteFixture,
} from "./write-fixtures.js";

let app: Application;
let fx: WriteFixture;

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

afterEach(async () => {
  await teardownWriteFixture();
});

function childBody(overrides: Record<string, unknown> = {}) {
  const uniq = Math.random().toString(36).slice(2, 7);
  return {
    displayName: "New Kid",
    dateOfBirth: "2015-03-03",
    gender: "MALE",
    country: "SA",
    grade: "Grade 4",
    curriculum: "BRITISH",
    subjects: ["Mathematics", "Science"],
    username: `newkid_${uniq}`,
    password: "kidpass1",
    ...overrides,
  };
}

describe("POST /children — create (US2)", () => {
  beforeEach(async () => {
    fx = await setupWriteFixture("FAMILY"); // childLimit 4, one existing child
  });

  it("creates a child and backfills loginCardUrl", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/children")
      .set("Authorization", `Bearer ${token}`)
      .send(childBody());
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.username).toBeDefined();

    const created = await prisma.child.findUnique({ where: { id: res.body.id } });
    expect(created).not.toBeNull();
    expect(created!.loginCardUrl).toBeTruthy();
  });

  it("rejects a duplicate username with 409 even after an advisory 'available'", async () => {
    const token = await mintOwnerToken(fx);
    const username = `dupe_${Math.random().toString(36).slice(2, 7)}`;

    const check = await request(app)
      .get(`/children/username-available?username=${username}`)
      .set("Authorization", `Bearer ${token}`);
    expect(check.body.available).toBe(true);

    const first = await request(app)
      .post("/children")
      .set("Authorization", `Bearer ${token}`)
      .send(childBody({ username }));
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/children")
      .set("Authorization", `Bearer ${token}`)
      .send(childBody({ username }));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CONFLICT");
  });

  it("refuses creation past the plan child limit with PLAN_LIMIT_REACHED (409)", async () => {
    const starterFx = await setupWriteFixture("STARTER"); // childLimit 1, already has 1 child
    const token = await mintOwnerToken(starterFx);
    const res = await request(app)
      .post("/children")
      .set("Authorization", `Bearer ${token}`)
      .send(childBody());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PLAN_LIMIT_REACHED");
  });
});
