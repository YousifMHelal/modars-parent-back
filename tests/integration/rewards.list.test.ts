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

describe("GET /rewards — list & get (US1)", () => {
  it("returns only the caller's family rewards", async () => {
    await prisma.reward.create({
      data: { familyId: fx.familyAId, title: "Mine", status: "ACTIVE" },
    });
    await prisma.reward.create({
      data: { familyId: fx.familyBId, title: "Theirs", status: "ACTIVE" },
    });

    const token = await mintOwnerToken(fx);
    const res = await request(app).get("/rewards").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.rewards.every((r: { title: string }) => r.title !== "Theirs")).toBe(true);
    expect(res.body.rewards.some((r: { title: string }) => r.title === "Mine")).toBe(true);
  });

  it("honors childId and status filters", async () => {
    await prisma.reward.create({
      data: { familyId: fx.familyAId, childId: fx.childId, title: "ChildReward", status: "ACTIVE" },
    });
    await prisma.reward.create({
      data: { familyId: fx.familyAId, title: "FamilyReward", status: "FULFILLED", fulfilledAt: new Date() },
    });

    const token = await mintOwnerToken(fx);

    const byChild = await request(app)
      .get(`/rewards?childId=${fx.childId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(byChild.status).toBe(200);
    expect(byChild.body.rewards.every((r: { childId: string | null }) => r.childId === fx.childId)).toBe(true);

    const byStatus = await request(app)
      .get("/rewards?status=FULFILLED")
      .set("Authorization", `Bearer ${token}`);
    expect(byStatus.status).toBe(200);
    expect(byStatus.body.rewards.every((r: { status: string }) => r.status === "FULFILLED")).toBe(true);
  });

  it("returns 404 for a cross-family reward id", async () => {
    const foreign = await prisma.reward.create({
      data: { familyId: fx.familyBId, title: "Foreign", status: "ACTIVE" },
    });
    const otherToken = await mintFamilyBOwnerToken(fx); // owns family B
    const ownToken = await mintOwnerToken(fx); // family A

    const okForOwner = await request(app)
      .get(`/rewards/${foreign.id}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(okForOwner.status).toBe(200);

    const deniedCrossFamily = await request(app)
      .get(`/rewards/${foreign.id}`)
      .set("Authorization", `Bearer ${ownToken}`);
    expect(deniedCrossFamily.status).toBe(404);
  });
});
