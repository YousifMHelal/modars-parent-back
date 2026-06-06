import { Router } from "express";
import express from "express";
import { webhookRateLimiter } from "../../middleware/writeRateLimit.js";
import * as controller from "./webhooks.controller.js";

// The provider webhook receiver (contracts/webhooks.openapi.yaml). NO session gate —
// authenticity is the provider signature over the RAW body. This router is mounted in
// app.ts BEFORE express.json() so the raw bytes reach the verifier intact (research.md
// §2). Its own rate-limit posture tolerates provider retry bursts (T050).

const router = Router();

router.post(
  "/webhooks/payments",
  webhookRateLimiter(),
  express.raw({ type: "*/*" }),
  controller.handlePaymentEvent,
);

export default router;
