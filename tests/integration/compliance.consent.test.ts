import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import prisma from "../../src/db/prisma.js";
import { recordConsent, hasValidConsent } from "../../src/lib/consent.js";
import {
  setupWriteFixture,
  teardownWriteFixture,
  mintOwnerToken,
  mintChildToken,
  type WriteFixture,
} from "./write-fixtures.js";

// US3 — consent capture + history (FR-005–007/025, SC-004). Onboarding writes records;
// re-consent appends; GET /settings/consent is family-scoped + parent-only.

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
  await prisma.consentRecord.deleteMany({
    where: { familyId: { in: [fx.familyAId, fx.familyBId] } },
  });
  await teardownWriteFixture();
});

describe("Onboarding writes consent records", () => {
  it("registration captures TERMS/PRIVACY/COPPA records", async () => {
    const email = `consent.onboard.${Math.random().toString(36).slice(2)}@test.consent`;
    const res = await request(app).post("/onboarding/register").send({
      fullName: "Onboarder",
      email,
      password: "ParentPass123!",
      dateOfBirth: "1985-01-01",
    });
    expect(res.status).toBe(201);

    const parent = await prisma.parent.findUnique({ where: { email }, select: { familyId: true } });
    const records = await prisma.consentRecord.findMany({
      where: { familyId: parent!.familyId },
    });
    expect(records.map((r) => r.type).sort()).toEqual(["COPPA", "PRIVACY", "TERMS"]);
    expect(await hasValidConsent(parent!.familyId, null, "COPPA")).toBe(true);

    // cleanup this ad-hoc family (FK order: sessions/tokens → parent → family)
    await prisma.consentRecord.deleteMany({ where: { familyId: parent!.familyId } });
    await prisma.authSession.deleteMany({ where: { familyId: parent!.familyId } });
    await prisma.emailVerificationToken.deleteMany({
      where: { parent: { familyId: parent!.familyId } },
    });
    await prisma.parent.deleteMany({ where: { familyId: parent!.familyId } });
    await prisma.family.deleteMany({ where: { id: parent!.familyId } });
  });
});

describe("Consent history read", () => {
  it("re-consent appends without overwriting; history is newest-first", async () => {
    await recordConsent(prisma, {
      familyId: fx.familyAId,
      parentId: fx.ownerParentId,
      type: "TERMS",
      version: "1.0",
      grantedAt: new Date("2026-01-01"),
    });
    await recordConsent(prisma, {
      familyId: fx.familyAId,
      parentId: fx.ownerParentId,
      type: "TERMS",
      version: "2.0",
      grantedAt: new Date("2026-02-01"),
    });

    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .get("/settings/consent?type=TERMS")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].version).toBe("2.0"); // newest first
    expect(res.body[1].version).toBe("1.0"); // prior preserved
  });

  it("is family-scoped (only the caller's family's records)", async () => {
    await recordConsent(prisma, {
      familyId: fx.familyBId,
      type: "PRIVACY",
      version: "1.0",
    });
    // Seed a record in family A so the scope comparison is meaningful.
    await recordConsent(prisma, { familyId: fx.familyAId, type: "TERMS", version: "1.0" });
    const token = await mintOwnerToken(fx);
    const res = await request(app).get("/settings/consent").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Every returned record belongs to family A; family B's PRIVACY record never appears.
    const familyBPrivacy = await prisma.consentRecord.findFirst({
      where: { familyId: fx.familyBId, type: "PRIVACY" },
      select: { id: true },
    });
    const returnedIds = (res.body as Array<{ id: string }>).map((r) => r.id);
    expect(returnedIds).not.toContain(familyBPrivacy?.id);
    expect(returnedIds.length).toBeGreaterThan(0);
  });

  it("rejects a child token with 403", async () => {
    const childToken = await mintChildToken(fx);
    const res = await request(app)
      .get("/settings/consent")
      .set("Authorization", `Bearer ${childToken}`);
    expect(res.status).toBe(403);
  });
});
