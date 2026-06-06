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

// US1 (T013): a VERIFIED success webhook activates a PENDING subscription — ACTIVE,
// currentPeriodEnd set, one PAID Invoice. A verified failure webhook leaves it PENDING
// with no paid invoice. An amount mismatch does not activate (flagged). No client
// endpoint can set ACTIVE. (SC-001, FR-003/004/017)

let app: Application;
let fx: WriteFixture;

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

beforeEach(async () => {
  fx = await pendingFamilyWithPlanAndChild("FAMILY");
});

afterEach(async () => {
  await teardownWriteFixture();
});

async function initiate(): Promise<string> {
  const token = await mintOwnerToken(fx);
  const res = await request(app)
    .post("/billing/initiate")
    .set("Authorization", `Bearer ${token}`)
    .send({});
  return res.body.intentId as string;
}

function postWebhook(rawBody: Buffer, signature: string) {
  return request(app)
    .post("/webhooks/payments")
    .set("X-Provider-Signature", signature)
    .set("Content-Type", "application/json")
    .send(rawBody.toString("utf-8"));
}

describe("POST /webhooks/payments — activation (US1)", () => {
  it("a verified success webhook activates the subscription with one PAID invoice", async () => {
    const intentId = await initiate();
    const { rawBody, signature } = signFakeEvent("payment_succeeded", intentId, {
      metadata: { subscriptionId: fx.subscriptionId, purpose: "ACTIVATION" },
    });

    const res = await postWebhook(rawBody, signature);
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const sub = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(sub!.status).toBe("ACTIVE");
    expect(sub!.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());

    const invoices = await prisma.invoice.findMany({
      where: { subscriptionId: fx.subscriptionId, status: "PAID" },
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.amountMinor).toBe(14900);
  });

  it("a verified failure webhook leaves the subscription PENDING with no paid invoice", async () => {
    const intentId = await initiate();
    const { rawBody, signature } = signFakeEvent("payment_failed", intentId, {
      metadata: { subscriptionId: fx.subscriptionId, purpose: "ACTIVATION" },
    });

    const res = await postWebhook(rawBody, signature);
    expect(res.status).toBe(200);

    const sub = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(sub!.status).toBe("PENDING");
    const paid = await prisma.invoice.count({
      where: { subscriptionId: fx.subscriptionId, status: "PAID" },
    });
    expect(paid).toBe(0);
  });

  it("an amount mismatch does not activate (flagged, no invoice)", async () => {
    const intentId = await initiate();
    const { rawBody, signature } = signFakeEvent("payment_succeeded", intentId, {
      amountMinor: 99, // != expected 14900
      metadata: { subscriptionId: fx.subscriptionId, purpose: "ACTIVATION" },
    });

    const res = await postWebhook(rawBody, signature);
    expect(res.status).toBe(200);

    const sub = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(sub!.status).toBe("PENDING");
    const intent = await prisma.paymentIntent.findUnique({ where: { id: intentId } });
    expect(intent!.status).toBe("FAILED");
    const paid = await prisma.invoice.count({
      where: { subscriptionId: fx.subscriptionId, status: "PAID" },
    });
    expect(paid).toBe(0);
  });
});
