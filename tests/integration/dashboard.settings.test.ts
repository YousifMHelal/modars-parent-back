import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import prisma from "../../src/db/prisma.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import {
  setupDashboardFixture,
  teardownDashboardFixture,
  mintParentToken,
  mintCoParentToken,
  mintChildToken,
  type DashboardFixture,
} from "./dashboard-fixtures.js";

let app: Application;
let fx: DashboardFixture;

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

beforeEach(async () => {
  await teardownDashboardFixture();
  fx = await setupDashboardFixture();
});

afterEach(async () => {
  await teardownDashboardFixture();
});

describe("GET /dashboard/settings", () => {
  it("returns account, prefs, and subscription summary", async () => {
    const token = await mintParentToken(fx);
    const res = await request(app)
      .get("/dashboard/settings")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({
      fullName: "Sarah Ahmed",
      email: "dash.owner@test.dash",
      phone: "+966 501234567",
      country: "Saudi Arabia",
      language: "en",
    });
    expect(res.body.notificationPrefs).toEqual({ push: true, email: true, whatsapp: false });
    expect(res.body.subscription).toMatchObject({
      planName: "Family Plan",
      childLimit: 4,
      childrenUsed: 2,
      currency: "SAR",
      billingCycle: "yearly",
      status: "active",
    });
    expect(res.body.subscription.priceLabel).toBe("SAR 1,499 / year");
    expect(res.body.subscription.renewalDate).toBe("June 15, 2027");
  });

  it("childrenUsed reflects the live non-deleted child count", async () => {
    // Soft-delete Layla → childrenUsed should drop to 1, childLimit unchanged.
    await prisma.child.update({
      where: { id: fx.laylaId },
      data: { deletedAt: new Date() },
    });

    const token = await mintParentToken(fx);
    const res = await request(app)
      .get("/dashboard/settings")
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.subscription.childrenUsed).toBe(1);
    expect(res.body.subscription.childLimit).toBe(4);
  });

  it("allows a co-parent to read settings (dashboard.view)", async () => {
    const token = await mintCoParentToken(fx);
    const res = await request(app)
      .get("/dashboard/settings")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.subscription.planName).toBe("Family Plan");
  });

  it("rejects a child token with 403", async () => {
    const token = await mintChildToken(fx);
    const res = await request(app)
      .get("/dashboard/settings")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
