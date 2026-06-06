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

// Cross-cutting scope audit across the Phase 4 per-child writes (SC-007):
//   child token → 403 everywhere; family A acting on family B's childId → 404.
describe("Phase 4 write family-scoping (US4 / SC-007)", () => {
  // Writes whose Zod body accepts a `{ grade }` payload (or no body). The credentials
  // endpoint is asserted separately because it requires a username/password/pin body.
  const childWrites = (childId: string) => [
    { method: "patch" as const, path: `/children/${childId}`, body: { grade: "Grade 9" } },
    { method: "post" as const, path: `/children/${childId}/pause`, body: {} },
    { method: "post" as const, path: `/children/${childId}/reactivate`, body: {} },
    { method: "delete" as const, path: `/children/${childId}`, body: {} },
    { method: "post" as const, path: `/children/${childId}/restore`, body: {} },
    {
      method: "patch" as const,
      path: `/children/${childId}/credentials`,
      body: { password: "newpass1" },
    },
  ];

  it("rejects a child token on every per-child write (403)", async () => {
    const childToken = await mintChildToken(fx);
    for (const w of childWrites(fx.childId)) {
      const res = await request(app)
        [w.method](w.path)
        .set("Authorization", `Bearer ${childToken}`)
        .send(w.body);
      expect(res.status, `${w.method} ${w.path}`).toBe(403);
    }
  });

  it("returns 404 when family A mutates family B's child", async () => {
    const ownerToken = await mintOwnerToken(fx);
    for (const w of childWrites(fx.familyBChildId)) {
      const res = await request(app)
        [w.method](w.path)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send(w.body);
      // edit/credentials/pause/reactivate/delete → 404; restore on a non-deleted foreign child → 404.
      expect(res.status, `${w.method} ${w.path}`).toBe(404);
    }
  });

  it("returns 404 when family B mutates family A's child", async () => {
    const bToken = await mintFamilyBOwnerToken(fx);
    const res = await request(app)
      .patch(`/children/${fx.childId}`)
      .set("Authorization", `Bearer ${bToken}`)
      .send({ grade: "Grade 9" });
    expect(res.status).toBe(404);
  });
});
