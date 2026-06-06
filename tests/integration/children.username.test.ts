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
  type WriteFixture,
} from "./write-fixtures.js";
import prisma from "../../src/db/prisma.js";

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

describe("GET /children/username-available (US2)", () => {
  it("returns available:true for a free username", async () => {
    const token = await mintOwnerToken(fx);
    const free = `free_${Math.random().toString(36).slice(2, 7)}`;
    const res = await request(app)
      .get(`/children/username-available?username=${free}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.suggestions).toEqual([]);
  });

  it("returns available:false + ≥3 available alternatives for a taken username", async () => {
    const token = await mintOwnerToken(fx);
    // The fixture child's username is taken; look it up to query it.
    const child = await prisma.child.findUnique({ where: { id: fx.childId } });
    const taken = child!.username;

    const res = await request(app)
      .get(`/children/username-available?username=${taken}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.suggestions.length).toBeGreaterThanOrEqual(3);
    // None of the suggestions equals the taken name.
    expect(res.body.suggestions).not.toContain(taken);
  });
});
