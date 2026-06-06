import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Application } from "express";
import { createApp } from "../../src/app.js";
import prisma from "../../src/db/prisma.js";
import { createRedisClient } from "../../src/db/redis.js";
import config from "../../src/config/index.js";
import {
  pendingFamilyWithPlanAndChild,
  teardownWriteFixture,
  mintOwnerToken,
  signFakeEvent,
  type WriteFixture,
} from "./write-fixtures.js";

// US3 (T029): an at-limit family's /billing/overflow-upgrade returns a server-computed
// prorated +SAR 25 quote + PaymentIntent(OVERFLOW); the slot (childSlotsUsed++) is
// granted ONLY on the verified overflow webhook; unconfirmed → not granted.
// (SC-002, FR-012/013/014)

let app: Application;
let fx: WriteFixture;

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

beforeEach(async () => {
  // STARTER: childLimit 1; the fixture already creates one child → at the limit.
  fx = await pendingFamilyWithPlanAndChild("STARTER");
  await prisma.subscription.update({
    where: { id: fx.subscriptionId },
    data: { status: "ACTIVE" },
  });
});

afterEach(async () => {
  await teardownWriteFixture();
});

function postWebhook(rawBody: Buffer, signature: string) {
  return request(app)
    .post("/webhooks/payments")
    .set("X-Provider-Signature", signature)
    .set("Content-Type", "application/json")
    .send(rawBody.toString("utf-8"));
}

describe("POST /billing/overflow-upgrade — US3", () => {
  it("at-limit → server-computed prorated +SAR 25 quote + OVERFLOW intent", async () => {
    const sub = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    const token = await mintOwnerToken(fx);
    const res = await request(app)
      .post("/billing/overflow-upgrade")
      .set("Authorization", `Bearer ${token}`)
      .send({ childDraftId: "draft_123" });

    expect(res.status).toBe(200);
    expect(res.body.intentId).toBeDefined();
    expect(res.body.currency).toBe("SAR");
    expect(res.body.remainingDays).toBeGreaterThan(0);

    // proratedAmountMinor == round(2500 * remainingDays / periodDays). periodDays=30.
    const expected = Math.round((2500 * res.body.remainingDays) / 30);
    expect(res.body.proratedAmountMinor).toBe(expected);

    const intent = await prisma.paymentIntent.findUnique({ where: { id: res.body.intentId } });
    expect(intent!.purpose).toBe("OVERFLOW");
    expect((intent!.metadata as { childDraftId?: string }).childDraftId).toBe("draft_123");

    // Not granted yet — childSlotsUsed unchanged until the webhook.
    const after = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(after!.childSlotsUsed).toBe(sub!.childSlotsUsed);
  });

  it("grants the slot (childSlotsUsed++) only on the verified overflow webhook", async () => {
    const token = await mintOwnerToken(fx);
    const quote = await request(app)
      .post("/billing/overflow-upgrade")
      .set("Authorization", `Bearer ${token}`)
      .send({ childDraftId: "draft_abc" });
    const intentId = quote.body.intentId as string;

    const before = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });

    const { rawBody, signature } = signFakeEvent("payment_succeeded", intentId, {
      amountMinor: quote.body.proratedAmountMinor,
      metadata: { subscriptionId: fx.subscriptionId, purpose: "OVERFLOW" },
    });
    const res = await postWebhook(rawBody, signature);
    expect(res.status).toBe(200);

    const after = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(after!.childSlotsUsed).toBe(before!.childSlotsUsed + 1);
  });

  it("a not-at-limit family → 422 (overflow does not apply)", async () => {
    // Bump the plan limit so there's a free slot.
    const familyFx = await pendingFamilyWithPlanAndChild("FAMILY"); // childLimit 4, 1 child
    await prisma.subscription.update({
      where: { id: familyFx.subscriptionId },
      data: { status: "ACTIVE" },
    });
    const token = await mintOwnerToken(familyFx);
    const res = await request(app)
      .post("/billing/overflow-upgrade")
      .set("Authorization", `Bearer ${token}`)
      .send({ childDraftId: "draft_x" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("PRORATION_UNCOMPUTABLE");
  });
});
