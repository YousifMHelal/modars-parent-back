import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import prisma from "../../src/db/prisma.js";
import {
  purgeDueDeletedFamilies,
  computePurgeAfter,
} from "../../src/modules/settings/settings.service.js";
import {
  setupWriteFixture,
  teardownWriteFixture,
  mintOwnerToken,
  mintCoParentToken,
  mintChildToken,
  type WriteFixture,
} from "./write-fixtures.js";

// US1 — account deletion, in-window cancel, and purge (FR-008–014/025, SC-003/005/010).

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

describe("Account deletion request + access revocation", () => {
  it("delete → 200 pending_deletion with a purge date, and access is revoked", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/settings/account/delete")
      .set("Authorization", `Bearer ${token}`)
      .send({ confirm: true });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending_deletion");
    expect(new Date(res.body.purgeAfter).getTime()).toBeGreaterThan(Date.now());

    // The owner's existing token is now revoked (session killed) → 401 on a protected route.
    const after = await request(app)
      .get("/dashboard/settings")
      .set("Authorization", `Bearer ${token}`);
    expect(after.status).toBe(401);
  });

  it("re-requesting is idempotent (no window reset)", async () => {
    const t1 = await mintOwnerToken(fx);
    const first = await request(app)
      .post("/settings/account/delete")
      .set("Authorization", `Bearer ${t1}`)
      .send({ confirm: true });
    const firstPurge = first.body.purgeAfter;

    // Token revoked by the first request; mint a fresh one for the second call.
    const t2 = await mintOwnerToken(fx);
    const second = await request(app)
      .post("/settings/account/delete")
      .set("Authorization", `Bearer ${t2}`)
      .send({ confirm: true });
    expect(second.status).toBe(200);
    expect(second.body.purgeAfter).toBe(firstPurge);
  });

  it("rejects a child token with 403 on delete and cancel", async () => {
    const childToken = await mintChildToken(fx);
    expect(
      (
        await request(app)
          .post("/settings/account/delete")
          .set("Authorization", `Bearer ${childToken}`)
          .send({ confirm: true })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/settings/account/delete/cancel")
          .set("Authorization", `Bearer ${childToken}`)
      ).status,
    ).toBe(403);
  });

  it("rejects a co-parent (owner-only family.delete) with 403", async () => {
    const coToken = await mintCoParentToken(fx);
    const res = await request(app)
      .post("/settings/account/delete")
      .set("Authorization", `Bearer ${coToken}`)
      .send({ confirm: true });
    expect(res.status).toBe(403);
  });

  it("rejects a missing confirmation at the Zod boundary (400)", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/settings/account/delete")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("a pending-deletion family cannot log in (FR-014)", async () => {
    const token = await mintOwnerToken(fx);
    await request(app)
      .post("/settings/account/delete")
      .set("Authorization", `Bearer ${token}`)
      .send({ confirm: true });

    const login = await request(app)
      .post("/auth/parent/login")
      .send({ email: fx.ownerEmail, password: "ParentPass123!" });
    expect(login.status).toBe(403);
  });
});

describe("Cancel restores access (zero data loss)", () => {
  it("cancel within the window restores the family to active", async () => {
    const token = await mintOwnerToken(fx);
    await request(app)
      .post("/settings/account/delete")
      .set("Authorization", `Bearer ${token}`)
      .send({ confirm: true });

    // Mint a fresh token (the prior one was revoked) and cancel.
    const t2 = await mintOwnerToken(fx);
    const cancel = await request(app)
      .post("/settings/account/delete/cancel")
      .set("Authorization", `Bearer ${t2}`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("active");

    // Login works again, and the child still exists (zero data loss).
    const login = await request(app)
      .post("/auth/parent/login")
      .send({ email: fx.ownerEmail, password: "ParentPass123!" });
    expect(login.status).toBe(200);
    expect(await prisma.child.findUnique({ where: { id: fx.childId } })).not.toBeNull();
  });

  it("cancel on an active family is a 409", async () => {
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/settings/account/delete/cancel")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
  });
});

describe("Purge sweep removes the family and releases usernames", () => {
  it("purge removes all family rows, frees the username, and is a no-op on re-run (SC-003/005)", async () => {
    const token = await mintOwnerToken(fx);
    await request(app)
      .post("/settings/account/delete")
      .set("Authorization", `Bearer ${token}`)
      .send({ confirm: true });

    const childUsername = (await prisma.child.findUnique({
      where: { id: fx.childId },
      select: { usernameNormalized: true },
    }))!.usernameNormalized;

    const after = new Date(computePurgeAfter(new Date()).getTime() + 1000);
    const purged = await purgeDueDeletedFamilies(after);
    expect(purged).toContain(fx.familyAId);

    expect(await prisma.family.findUnique({ where: { id: fx.familyAId } })).toBeNull();
    expect(await prisma.child.findUnique({ where: { id: fx.childId } })).toBeNull();
    expect(
      await prisma.child.findUnique({ where: { usernameNormalized: childUsername } }),
    ).toBeNull();

    // Re-run is a clean no-op.
    const second = await purgeDueDeletedFamilies(after);
    expect(second).not.toContain(fx.familyAId);
  });
});
