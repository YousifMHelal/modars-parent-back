import rateLimit from "express-rate-limit";
import { ErrorCode } from "../lib/errors.js";

// Per-endpoint rate limiter for the Phase 4 public write routes
// (onboarding register, co-parent accept, username-available), mirroring the
// auth module's authLimiter. In test mode the cap is raised so the suite never
// trips the limiter (matches tests/integration/auth.* behavior).

const isTest = process.env["NODE_ENV"] === "test";

export function publicWriteLimiter(max: number, windowMs = 15 * 60 * 1000) {
  return rateLimit({
    windowMs,
    max: isTest ? 10_000 : max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: ErrorCode.RATE_LIMITED, message: "Too many requests, try later" },
      });
    },
  });
}

// Dedicated limiter for the provider payment webhook (T050, plan.md Tech & Security).
// The provider may legitimately burst retries on a non-2xx, so the cap is generous
// and separate from the global limiter — high enough not to block real redeliveries,
// bounded enough to blunt an unauthenticated flood (a bad signature still 400s cheaply
// before any DB work). Lifted in test so the idempotency suite can replay freely.
export function webhookRateLimiter(max = 300, windowMs = 60 * 1000) {
  return rateLimit({
    windowMs,
    max: isTest ? 100_000 : max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: ErrorCode.RATE_LIMITED, message: "Too many requests, try later" },
      });
    },
  });
}
