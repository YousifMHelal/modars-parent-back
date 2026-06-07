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

describe("PATCH /dashboard/reminders/:id", () => {
  async function getEnabled(token: string, id: string): Promise<boolean> {
    const res = await request(app)
      .get("/dashboard/reminders")
      .set("Authorization", `Bearer ${token}`);
    return res.body.reminders.find((r: { id: string }) => r.id === id).enabled;
  }

  it("enables a reminder and the change survives a fresh read", async () => {
    const token = await mintParentToken(fx);
    expect(await getEnabled(token, "missed-session")).toBe(false);

    const res = await request(app)
      .patch("/dashboard/reminders/missed-session")
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(
      res.body.reminders.find((r: { id: string }) => r.id === "missed-session").enabled,
    ).toBe(true);
    // The reload bug: re-fetch from the server and confirm it stuck.
    expect(await getEnabled(token, "missed-session")).toBe(true);
  });

  it("disables a reminder", async () => {
    const token = await mintParentToken(fx);
    expect(await getEnabled(token, "daily-study")).toBe(true);

    const res = await request(app)
      .patch("/dashboard/reminders/daily-study")
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(await getEnabled(token, "daily-study")).toBe(false);
  });

  it("persists a days change and merges it over existing time settings", async () => {
    const token = await mintParentToken(fx);

    const res = await request(app)
      .patch("/dashboard/reminders/daily-study")
      .set("Authorization", `Bearer ${token}`)
      .send({ settings: { days: ["Mon", "Wed", "Fri"] } });

    expect(res.status).toBe(200);
    const daily = res.body.reminders.find((r: { id: string }) => r.id === "daily-study");
    expect(daily.settings.days).toEqual(["Mon", "Wed", "Fri"]);
    // The merge preserves the seeded time rather than wiping it.
    expect(daily.settings.time).toBe("17:00");

    // Survives a fresh read (the reload check).
    const reread = await request(app)
      .get("/dashboard/reminders")
      .set("Authorization", `Bearer ${token}`);
    const rereadDaily = reread.body.reminders.find(
      (r: { id: string }) => r.id === "daily-study",
    );
    expect(rereadDaily.settings.days).toEqual(["Mon", "Wed", "Fri"]);
  });

  it("can change enabled and settings together", async () => {
    const token = await mintParentToken(fx);
    const res = await request(app)
      .patch("/dashboard/reminders/daily-study")
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: false, settings: { time: "08:30" } });

    expect(res.status).toBe(200);
    const daily = res.body.reminders.find((r: { id: string }) => r.id === "daily-study");
    expect(daily.enabled).toBe(false);
    expect(daily.settings.time).toBe("08:30");
  });

  it("404s an unknown reminder slug", async () => {
    const token = await mintParentToken(fx);
    const res = await request(app)
      .patch("/dashboard/reminders/not-a-real-reminder")
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: true });
    expect(res.status).toBe(404);
  });

  it("400s a missing/invalid body", async () => {
    const token = await mintParentToken(fx);
    const res = await request(app)
      .patch("/dashboard/reminders/daily-study")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects a child token with 403", async () => {
    const token = await mintChildToken(fx);
    const res = await request(app)
      .patch("/dashboard/reminders/daily-study")
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: true });
    expect(res.status).toBe(403);
  });
});
