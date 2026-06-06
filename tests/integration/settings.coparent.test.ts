import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import prisma from "../../src/db/prisma.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import * as mailer from "../../src/lib/mailer.js";
import {
  setupWriteFixture,
  teardownWriteFixture,
  mintOwnerToken,
  mintCoParentToken,
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
  vi.restoreAllMocks();
  await teardownWriteFixture();
  await prisma.parent.deleteMany({ where: { email: { contains: "@coparent.invite" } } });
});

/** Capture the plaintext token from the stub mailer's emitted invite link. */
function captureToken(): { read: () => string | null } {
  let token: string | null = null;
  vi.spyOn(mailer, "send").mockImplementation((msg) => {
    const m = /token=([^\s&"]+)/.exec(msg.text);
    if (m) token = decodeURIComponent(m[1]!);
  });
  return { read: () => token };
}

describe("Co-parent invite / accept / revoke (US4)", () => {
  it("invite → accept creates a CO_PARENT parent + session", async () => {
    const ownerToken = await mintOwnerToken(fx);
    const capture = captureToken();
    const email = `joe.${Math.random().toString(36).slice(2, 7)}@coparent.invite`;

    const invite = await request(app)
      .post("/settings/co-parent/invite")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email });
    expect(invite.status).toBe(201);

    const inv = await prisma.coParentInvitation.findFirst({ where: { email } });
    expect(inv!.status).toBe("PENDING");

    const token = capture.read();
    expect(token).toBeTruthy();

    const accept = await request(app)
      .post("/co-parent/accept")
      .send({ token, fullName: "Joe Co", password: "secret123", dateOfBirth: "1990-01-01" });
    expect(accept.status).toBe(201);
    expect(accept.body.accessToken).toBeDefined();

    const coParent = await prisma.parent.findUnique({ where: { email } });
    expect(coParent!.role).toBe("CO_PARENT");
    expect(coParent!.familyId).toBe(fx.familyAId);

    const after = await prisma.coParentInvitation.findUnique({ where: { id: inv!.id } });
    expect(after!.status).toBe("ACCEPTED");
  });

  it("co-parent and child are denied invite (403); only owner may invite", async () => {
    const coToken = await mintCoParentToken(fx);
    const childToken = await mintChildToken(fx);

    const co = await request(app)
      .post("/settings/co-parent/invite")
      .set("Authorization", `Bearer ${coToken}`)
      .send({ email: "x@coparent.invite" });
    expect(co.status).toBe(403);

    const child = await request(app)
      .post("/settings/co-parent/invite")
      .set("Authorization", `Bearer ${childToken}`)
      .send({ email: "y@coparent.invite" });
    expect(child.status).toBe(403);
  });

  it("revoke blocks acceptance", async () => {
    const ownerToken = await mintOwnerToken(fx);
    const capture = captureToken();
    const email = `rev.${Math.random().toString(36).slice(2, 7)}@coparent.invite`;

    await request(app)
      .post("/settings/co-parent/invite")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email });
    const inv = await prisma.coParentInvitation.findFirst({ where: { email } });

    const revoke = await request(app)
      .post(`/settings/co-parent/${inv!.id}/revoke`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(revoke.status).toBe(200);

    const accept = await request(app)
      .post("/co-parent/accept")
      .send({
        token: capture.read(),
        fullName: "Rev",
        password: "secret123",
        dateOfBirth: "1990-01-01",
      });
    expect(accept.status).toBe(400);
  });

  it("a tampered/invalid token is refused (400)", async () => {
    const accept = await request(app)
      .post("/co-parent/accept")
      .send({
        token: "not-a-real-token",
        fullName: "Nope",
        password: "secret123",
        dateOfBirth: "1990-01-01",
      });
    expect(accept.status).toBe(400);
  });

  it("inviting an already-registered email is refused with 409 (FR-026)", async () => {
    const ownerToken = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/settings/co-parent/invite")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: fx.ownerEmail }); // already a parent
    expect(res.status).toBe(409);
  });

  it("an accepted co-parent is denied children.delete but allowed children.edit", async () => {
    const ownerToken = await mintOwnerToken(fx);
    const capture = captureToken();
    const email = `perm.${Math.random().toString(36).slice(2, 7)}@coparent.invite`;
    await request(app)
      .post("/settings/co-parent/invite")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email });
    const accept = await request(app)
      .post("/co-parent/accept")
      .send({
        token: capture.read(),
        fullName: "Perm Co",
        password: "secret123",
        dateOfBirth: "1990-01-01",
      });
    const coToken = accept.body.accessToken as string;

    // Allowed: edit a child in the family.
    const edit = await request(app)
      .patch(`/children/${fx.childId}`)
      .set("Authorization", `Bearer ${coToken}`)
      .send({ grade: "Grade 9" });
    expect(edit.status).toBe(200);

    // Denied: delete a child (owner-only).
    const del = await request(app)
      .delete(`/children/${fx.childId}`)
      .set("Authorization", `Bearer ${coToken}`);
    expect(del.status).toBe(403);
  });
});
