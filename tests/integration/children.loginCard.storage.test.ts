import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import prisma from "../../src/db/prisma.js";
import storage from "../../src/lib/storage.js";
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
  vi.restoreAllMocks();
  await teardownWriteFixture();
});

function newChildBody() {
  const uniq = Math.random().toString(36).slice(2, 7);
  return {
    displayName: "Degrade Kid",
    dateOfBirth: "2015-03-03",
    gender: "MALE",
    country: "SA",
    grade: "Grade 4",
    curriculum: "BRITISH",
    subjects: ["Mathematics"],
    username: `degradekid_${uniq}`,
    password: "kidpass1",
  };
}

describe("login-card storage — graceful degradation (US3, SC-007/008)", () => {
  it("a failing storage backend leaves child create at 201 with loginCardUrl null", async () => {
    vi.spyOn(storage, "put").mockRejectedValue(new Error("backend unreachable"));

    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/children")
      .set("Authorization", `Bearer ${token}`)
      .send(newChildBody());

    expect(res.status).toBe(201);
    const stored = await prisma.child.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.loginCardUrl).toBeNull();
  });

  it("on success the stored ref is an app /files/... reference, not a raw bucket URL", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/children")
      .set("Authorization", `Bearer ${token}`)
      .send(newChildBody());

    expect(res.status).toBe(201);
    const stored = await prisma.child.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.loginCardUrl).toBe(`/files/login-cards/${res.body.id}`);
    expect(stored.loginCardUrl).toMatch(/^\/files\//);
  });
});
