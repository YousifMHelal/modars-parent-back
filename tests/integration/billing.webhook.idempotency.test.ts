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

// US2 (T023): the same success event delivered N times → exactly ONE activation + ONE
// Invoice (via WebhookEvent.providerEventId @unique). A bad/absent signature → 400, no
// state change, no existence leak. (SC-003, FR-007/008/011)

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

function postWebhook(rawBody: Buffer, signature: string | undefined) {
  const req = request(app)
    .post("/webhooks/payments")
    .set("Content-Type", "application/json");
  if (signature !== undefined) req.set("X-Provider-Signature", signature);
  return req.send(rawBody.toString("utf-8"));
}

describe("POST /webhooks/payments — idempotency (US2)", () => {
  it("N deliveries of the same event → exactly one activation + one invoice", async () => {
    const intentId = await initiate();
    // Same event id across all deliveries (the dedup key) — unique per run so the
    // global WebhookEvent ledger doesn't carry it over between suite executions.
    const eventId = `evt_idem_${Math.random().toString(36).slice(2)}`;
    const { rawBody, signature } = signFakeEvent("payment_succeeded", intentId, {
      eventId,
      metadata: { subscriptionId: fx.subscriptionId, purpose: "ACTIVATION" },
    });

    for (let i = 0; i < 4; i++) {
      const res = await postWebhook(rawBody, signature);
      expect(res.status).toBe(200);
    }

    const sub = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(sub!.status).toBe("ACTIVE");

    const paid = await prisma.invoice.count({
      where: { subscriptionId: fx.subscriptionId, status: "PAID" },
    });
    expect(paid).toBe(1);

    const ledger = await prisma.webhookEvent.count({ where: { providerEventId: eventId } });
    expect(ledger).toBe(1);
  });

  it("a bad signature → 400, no state change, no existence leak", async () => {
    const intentId = await initiate();
    const { rawBody } = signFakeEvent("payment_succeeded", intentId, {
      metadata: { subscriptionId: fx.subscriptionId, purpose: "ACTIVATION" },
    });

    const res = await postWebhook(rawBody, "deadbeef");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("WEBHOOK_SIGNATURE_INVALID");
    // The 400 body says nothing about whether the subscription exists.
    expect(JSON.stringify(res.body)).not.toContain(fx.subscriptionId);

    const sub = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(sub!.status).toBe("PENDING");
  });

  it("an absent signature → 400, no state change", async () => {
    const intentId = await initiate();
    const { rawBody } = signFakeEvent("payment_succeeded", intentId, {
      metadata: { subscriptionId: fx.subscriptionId, purpose: "ACTIVATION" },
    });

    const res = await postWebhook(rawBody, undefined);
    expect(res.status).toBe(400);

    const sub = await prisma.subscription.findUnique({ where: { id: fx.subscriptionId } });
    expect(sub!.status).toBe("PENDING");
  });
});
