import type { Request, Response } from "express";
import pino from "pino";
import * as service from "./webhooks.service.js";
import { WebhookSignatureInvalidError } from "../../lib/errors.js";

const logger = pino({ name: "webhooks.controller" });

// The webhook controller (contracts/webhooks.openapi.yaml). It does NOT use the
// next(err) → errorHandler path for transient failures: the provider must see a 5xx
// to retry (FR-010), and a bad signature must 400 with no existence leak (FR-011).
//
// req.body here is the raw Buffer (express.raw mounted before express.json).

export async function handlePaymentEvent(req: Request, res: Response): Promise<void> {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const signature = req.header("X-Provider-Signature") ?? undefined;

  try {
    await service.processWebhook(rawBody, signature);
    res.status(200).json({ received: true });
  } catch (err) {
    if (err instanceof WebhookSignatureInvalidError) {
      // 400, leak nothing about whether any subscription exists (FR-011).
      res.status(400).json({ error: { code: err.code, message: err.message } });
      return;
    }
    // Transient/unexpected failure → 5xx so the provider redelivers; the retry is
    // idempotent via the WebhookEvent ledger (FR-010).
    logger.error({ err }, "webhook processing failed (provider will retry)");
    res
      .status(500)
      .json({ error: { code: "INTERNAL_ERROR", message: "Webhook processing failed" } });
  }
}
