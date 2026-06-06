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
  mintCoParentToken,
  mintChildToken,
  type WriteFixture,
} from "./write-fixtures.js";

// US4 (T041): across ALL parent-facing billing writes — child token → 403; cross-family
// subscription/invoice id → 404; co-parent DENIED cancel/payment-method/plan-change
// (403) while history read succeeds. (SC-007/009, FR-023/024/025)

let app: Application;
let fx: WriteFixture;

beforeAll(() => {
  createRedisClient(config.REDIS_URL);
  app = createApp();
});

beforeEach(async () => {
  fx = await pendingFamilyWithPlanAndChild("FAMILY");
  await prisma.subscription.update({
    where: { id: fx.subscriptionId },
    data: { status: "ACTIVE" },
  });
});

afterEach(async () => {
  await teardownWriteFixture();
});

// All parent-facing billing write endpoints (method, path, minimal body).
const WRITE_ENDPOINTS: Array<{ method: "post" | "patch"; path: string; body?: object }> = [
  { method: "post", path: "/billing/initiate", body: {} },
  { method: "post", path: "/billing/overflow-upgrade", body: { childDraftId: "d_1" } },
  { method: "post", path: "/billing/plan-change", body: { targetPlan: "family-pro" } },
  { method: "patch", path: "/billing/payment-method", body: { providerMethodRef: "pm_1" } },
  { method: "post", path: "/billing/cancel" },
  { method: "post", path: "/billing/reactivate" },
];

function send(method: "post" | "patch", path: string, token: string, body?: object) {
  const req =
    method === "post" ? request(app).post(path) : request(app).patch(path);
  return req.set("Authorization", `Bearer ${token}`).send(body ?? {});
}

describe("billing authorization & scoping — US4", () => {
  it("a child token is rejected (403) on every parent-facing billing write", async () => {
    const token = await mintChildToken(fx);
    for (const ep of WRITE_ENDPOINTS) {
      const res = await send(ep.method, ep.path, token, ep.body);
      expect(res.status, `${ep.method.toUpperCase()} ${ep.path}`).toBe(403);
    }
  });

  it("a child token is rejected (403) on billing reads too", async () => {
    const token = await mintChildToken(fx);
    const history = await request(app)
      .get("/billing/history")
      .set("Authorization", `Bearer ${token}`);
    expect(history.status).toBe(403);
  });

  it("a co-parent is denied owner-only billing writes (403)", async () => {
    const token = await mintCoParentToken(fx);
    for (const ep of WRITE_ENDPOINTS) {
      const res = await send(ep.method, ep.path, token, ep.body);
      expect(res.status, `${ep.method.toUpperCase()} ${ep.path}`).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
  });

  it("a co-parent IS permitted to read billing history (dashboard.view)", async () => {
    const token = await mintCoParentToken(fx);
    const res = await request(app)
      .get("/billing/history")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("a missing/unknown token is 401 on a billing write", async () => {
    const res = await request(app).post("/billing/cancel");
    expect(res.status).toBe(401);
  });

  it("payment-method rejects raw card data, accepts only a provider token (FR-027)", async () => {
    const token = await mintOwnerToken(fx);

    const rawCard = await request(app)
      .patch("/billing/payment-method")
      .set("Authorization", `Bearer ${token}`)
      .send({ providerMethodRef: "pm_ok", cardNumber: "4242424242424242", cvv: "123" });
    expect(rawCard.status).toBe(400);
    expect(rawCard.body.error.code).toBe("VALIDATION_ERROR");

    const tokenOnly = await request(app)
      .patch("/billing/payment-method")
      .set("Authorization", `Bearer ${token}`)
      .send({ providerMethodRef: "pm_ok" });
    expect(tokenOnly.status).toBe(200);
    expect(tokenOnly.body.brand).toBeDefined();
    // Nothing resembling a PAN is echoed back.
    expect(JSON.stringify(tokenOnly.body)).not.toContain("4242");
  });
});
