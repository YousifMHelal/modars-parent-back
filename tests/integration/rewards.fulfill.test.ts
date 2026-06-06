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

async function createActiveReward(): Promise<string> {
  const reward = await prisma.reward.create({
    data: { familyId: fx.familyAId, title: "Pizza night", status: "ACTIVE" },
  });
  return reward.id;
}

describe("POST /rewards/:id/fulfill — manual fulfill (US1)", () => {
  it("fulfills an ACTIVE reward → 200 FULFILLED with fulfilledAt", async () => {
    const token = await mintOwnerToken(fx);
    const id = await createActiveReward();

    const res = await request(app)
      .post(`/rewards/${id}/fulfill`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("FULFILLED");
    expect(res.body.fulfilledAt).toBeTruthy();
  });

  it("is idempotent — a repeat fulfill keeps the same fulfilledAt (no double-fulfill)", async () => {
    const token = await mintOwnerToken(fx);
    const id = await createActiveReward();

    const first = await request(app)
      .post(`/rewards/${id}/fulfill`)
      .set("Authorization", `Bearer ${token}`);
    const second = await request(app)
      .post(`/rewards/${id}/fulfill`)
      .set("Authorization", `Bearer ${token}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("FULFILLED");
    expect(second.body.fulfilledAt).toBe(first.body.fulfilledAt);
  });

  it("rejects a child token → 403", async () => {
    const token = await mintChildToken(fx);
    const id = await createActiveReward();
    const res = await request(app)
      .post(`/rewards/${id}/fulfill`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("returns 404 for another family's reward", async () => {
    const id = await createActiveReward();
    const otherToken = await mintFamilyBOwnerToken(fx);
    const res = await request(app)
      .post(`/rewards/${id}/fulfill`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(404);

    // And it must NOT have been fulfilled by the foreign call.
    const row = await prisma.reward.findUnique({ where: { id } });
    expect(row!.status).toBe("ACTIVE");
  });
});
