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
