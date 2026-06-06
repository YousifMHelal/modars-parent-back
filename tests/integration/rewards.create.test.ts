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
  mintChildToken,
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

describe("POST /rewards — create (US1)", () => {
  it("creates a reward with no goal → 201 ACTIVE, family-scoped", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/rewards")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Trip to the cinema" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("ACTIVE");
    expect(res.body.claimable).toBe(false);
    expect(res.body.goalProgress).toBeNull();
    expect(res.body.fulfilledAt).toBeNull();

    const row = await prisma.reward.findUnique({ where: { id: res.body.id } });
    expect(row!.familyId).toBe(fx.familyAId);
  });

  it("rejects a child token with 403", async () => {
    const token = await mintChildToken(fx);
    const res = await request(app)
      .post("/rewards")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "x" });
    expect(res.status).toBe(403);
  });

  it("rejects a foreign-family child as childId → 404", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/rewards")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Goal for other kid", childId: fx.familyBChildId, goalMetric: "XP", goalTarget: 100 });
    expect(res.status).toBe(404);
  });

  it("rejects client-supplied goalCurrent → 400", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/rewards")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "x", goalCurrent: 9999 });
    expect(res.status).toBe(400);
  });

  it("rejects a goal without a target → 400", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/rewards")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "x", childId: fx.childId, goalMetric: "XP" });
    expect(res.status).toBe(400);
  });
});
