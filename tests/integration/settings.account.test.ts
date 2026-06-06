import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
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

describe("Settings account & notification writes (US3)", () => {
  it("account patch persists and surfaces in GET /dashboard/settings", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .patch("/settings/account")
      .set("Authorization", `Bearer ${token}`)
      .send({ fullName: "Renamed Owner", country: "AE" });
    expect(res.status).toBe(200);

    const settings = await request(app)
      .get("/dashboard/settings")
      .set("Authorization", `Bearer ${token}`);
    expect(settings.body.account.fullName).toBe("Renamed Owner");
    expect(settings.body.account.country).toBe("AE");
  });

  it("notification-prefs patch persists and surfaces in notificationPrefs", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .patch("/settings/notifications")
      .set("Authorization", `Bearer ${token}`)
      .send({ push: false, whatsapp: true });
    expect(res.status).toBe(200);

    const settings = await request(app)
      .get("/dashboard/settings")
      .set("Authorization", `Bearer ${token}`);
    expect(settings.body.notificationPrefs).toEqual({
      push: false,
      email: true,
      whatsapp: true,
    });
  });

  it("invalid input → 422-class rejection with nothing saved", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .patch("/settings/account")
      .set("Authorization", `Bearer ${token}`)
      .send({ country: "X" }); // too short (min 2)
    expect(res.status).toBe(400); // Zod boundary failure (VALIDATION_ERROR)

    const settings = await request(app)
      .get("/dashboard/settings")
      .set("Authorization", `Bearer ${token}`);
    // Original owner name unchanged.
    expect(settings.body.account.fullName).toBe("Owner Parent");
  });

  it("rejects a child token with 403", async () => {
    const token = await mintChildToken(fx);
    const res = await request(app)
      .patch("/settings/account")
      .set("Authorization", `Bearer ${token}`)
      .send({ fullName: "Hacker" });
    expect(res.status).toBe(403);
  });
});
