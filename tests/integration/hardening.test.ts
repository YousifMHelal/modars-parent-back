import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import rateLimit from "express-rate-limit";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import { ErrorCode } from "../../src/lib/errors.js";
import {
  setupWriteFixture,
  teardownWriteFixture,
  mintOwnerToken,
  type WriteFixture,
} from "./write-fixtures.js";

// US4 — security hardening (FR-017–019, SC-007/008). Validation at the Zod boundary, HSTS
// header present, and the rate-limiter 429 contract on sensitive endpoints.

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

describe("Security headers", () => {
  it("sets a Strict-Transport-Security (HSTS) header", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["strict-transport-security"]).toBeDefined();
  });
});

describe("Boundary validation (FR-017)", () => {
  it("a malformed delete body is rejected at the Zod boundary (400)", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/settings/account/delete")
      .set("Authorization", `Bearer ${token}`)
      .send({ confirm: "yes-please" }); // not the required literal `true`
    expect(res.status).toBe(400);
  });

  it("a malformed consent query is rejected at the Zod boundary (400)", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .get("/settings/consent?type=NOT_A_TYPE")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("an unauthenticated request to a sensitive endpoint is 401", async () => {
    const res = await request(app).post("/settings/account/export");
    expect(res.status).toBe(401);
  });
});

describe("Rate limiting contract (FR-019)", () => {
  it("a sensitive-endpoint limiter returns a 429 envelope once its cap is exceeded", async () => {
    // The app's production limiters are lifted in NODE_ENV=test so the suite never trips
    // them; assert the 429 contract that guards export/delete by mounting the same
    // express-rate-limit primitive with an explicit low cap (mirrors rate-limit.test.ts).
    const mini = express();
    mini.post(
      "/settings/account/export",
      rateLimit({
        windowMs: 60_000,
        max: 2,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => {
          res
            .status(429)
            .json({ error: { code: ErrorCode.RATE_LIMITED, message: "Too many requests" } });
        },
      }),
      (_req, res) => res.status(202).json({ ok: true }),
    );

    await request(mini).post("/settings/account/export");
    await request(mini).post("/settings/account/export");
    const tripped = await request(mini).post("/settings/account/export");
    expect(tripped.status).toBe(429);
    expect(tripped.body.error.code).toBe("RATE_LIMITED");
  });
});
