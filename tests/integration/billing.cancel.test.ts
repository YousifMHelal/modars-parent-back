import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import prisma from "../../src/db/prisma.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import {
  pendingFamilyWithPlanAndChild,
  teardownWriteFixture,
  mintOwnerToken,
  type WriteFixture,
} from "./write-fixtures.js";

// US4 (T040): cancel sets canceledAt/canceledEffectiveAt=period end, status CANCELED,
// stops renewals, marks for purge (no delete); reactivate within the window → ACTIVE;
// reactivate after the window → 422. (SC-008, FR-021/022)

let app: Application;
let fx: WriteFixture;

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

beforeEach(async () => {
  fx = await pendingFamilyWithPlanAndChild("FAMILY");
  await prisma.subscription.update({
    where: { id: fx.subscriptionId },
    data: { status: "ACTIVE", currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000) },
  });
});

afterEach(async () => {
  await teardownWriteFixture();
});

describe("POST /billing/cancel + /billing/reactivate — US4", () => {
  it("cancel retains to period end, marks for purge, does NOT delete", async () => {
    const sub = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/billing/cancel")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELED");
    expect(new Date(res.body.canceledEffectiveAt).getTime()).toBe(sub!.currentPeriodEnd.getTime());

    const after = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(after).not.toBeNull(); // not deleted
    expect(after!.status).toBe("CANCELED");
    expect(after!.canceledAt).not.toBeNull();
    expect(after!.canceledEffectiveAt!.getTime()).toBe(sub!.currentPeriodEnd.getTime());
    expect(after!.deletedAt).toBeNull();
  });

  it("reactivate within the retain window restores ACTIVE", async () => {
    const token = await mintOwnerToken(fx);
    await request(app).post("/billing/cancel").set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .post("/billing/reactivate")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.subscription.status).toBe("ACTIVE");

    const after = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(after!.status).toBe("ACTIVE");
    expect(after!.canceledAt).toBeNull();
    expect(after!.canceledEffectiveAt).toBeNull();
  });

  it("reactivate after the window elapsed → 422", async () => {
    const token = await mintOwnerToken(fx);
    await request(app).post("/billing/cancel").set("Authorization", `Bearer ${token}`);
    // Force the retain window into the past.
    await prisma.subscription.update({
      where: { id: fx.subscriptionId },
      data: { canceledEffectiveAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post("/billing/reactivate")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("RETAIN_WINDOW_ELAPSED");
  });
});
