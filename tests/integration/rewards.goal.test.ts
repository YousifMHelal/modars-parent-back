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

describe("Reward goal tracking (US2)", () => {
  it("XP goal → goalProgress equals child.totalXp; reaching target → claimable while ACTIVE", async () => {
    await prisma.child.update({ where: { id: fx.childId }, data: { totalXp: 5000 } });
    const reward = await prisma.reward.create({
      data: {
        familyId: fx.familyAId,
        childId: fx.childId,
        title: "New book",
        goalMetric: "XP",
        goalTarget: 5000,
        status: "ACTIVE",
      },
    });

    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .get(`/rewards/${reward.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.goalProgress).toBe(5000);
    expect(res.body.claimable).toBe(true);
    expect(res.body.status).toBe("ACTIVE"); // claimable does NOT fulfill it
  });

  it("SESSIONS goal → goalProgress equals the count of completed (scored) sessions", async () => {
    await prisma.session.createMany({
      data: [
        { familyId: fx.familyAId, childId: fx.childId, subject: "Math", startedAt: new Date(), durationMinutes: 20, topics: ["a"], score: 80 },
        { familyId: fx.familyAId, childId: fx.childId, subject: "Math", startedAt: new Date(), durationMinutes: 20, topics: ["b"], score: 90 },
        { familyId: fx.familyAId, childId: fx.childId, subject: "Math", startedAt: new Date(), durationMinutes: 20, topics: ["c"] }, // not scored → not counted
      ],
    });
    const reward = await prisma.reward.create({
      data: {
        familyId: fx.familyAId,
        childId: fx.childId,
        title: "Sessions goal",
        goalMetric: "SESSIONS",
        goalTarget: 2,
        status: "ACTIVE",
      },
    });

    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .get(`/rewards/${reward.id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.goalProgress).toBe(2);
    expect(res.body.claimable).toBe(true);
  });

  it("rejects an edit attempting to set progress → 400", async () => {
    const reward = await prisma.reward.create({
      data: { familyId: fx.familyAId, title: "x", status: "ACTIVE" },
    });
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .patch(`/rewards/${reward.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ goalCurrent: 123 });
    expect(res.status).toBe(400);
  });
});
