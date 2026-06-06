import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import {
  setupDashboardFixture,
  teardownDashboardFixture,
  mintParentToken,
  mintChildToken,
  type DashboardFixture,
} from "./dashboard-fixtures.js";

let app: Application;
let fx: DashboardFixture;

const EXPECTED_ORDER = [
  "daily-study",
  "homework-due",
  "streak-protection",
  "missed-session",
  "weekly-summary",
  "struggle-alert",
  "exam-countdown",
  "achievement",
  "reward-redeemed",
];

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

describe("GET /dashboard/reminders", () => {
  it("returns all 9 entries in display order", async () => {
    const token = await mintParentToken(fx);
    const res = await request(app)
      .get("/dashboard/reminders")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.reminders).toHaveLength(9);
    expect(res.body.reminders.map((r: { id: string }) => r.id)).toEqual(EXPECTED_ORDER);
  });

  it("matches the mock's enabled/recipient/hasSettings/settings per type", async () => {
    const token = await mintParentToken(fx);
    const res = await request(app)
      .get("/dashboard/reminders")
      .set("Authorization", `Bearer ${token}`);

    const byId = Object.fromEntries(res.body.reminders.map((r: { id: string }) => [r.id, r]));

    expect(byId["daily-study"]).toMatchObject({
      type: "Daily Study Reminder",
      recipient: "Child",
      enabled: true,
      hasSettings: true,
    });
    expect(byId["daily-study"].settings).toMatchObject({ time: "17:00" });

    expect(byId["homework-due"]).toMatchObject({
      recipient: "Both",
      enabled: true,
      hasSettings: true,
    });
    expect(byId["homework-due"].settings).toMatchObject({ leadTimeHours: 24 });

    expect(byId["missed-session"]).toMatchObject({ recipient: "Parent", enabled: false });
    expect(byId["struggle-alert"]).toMatchObject({ hasSettings: false, enabled: true });
    expect(byId["exam-countdown"].enabled).toBe(false);
  });

  it("rejects a child token with 403", async () => {
    const token = await mintChildToken(fx);
    const res = await request(app)
      .get("/dashboard/reminders")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
