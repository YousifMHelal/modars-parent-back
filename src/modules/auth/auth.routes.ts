import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "../../middleware/validate.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole, requirePermission } from "../../middleware/requirePermission.js";
import * as controller from "./auth.controller.js";
import { oauthCallbackAuth } from "../../lib/oauth.js";
import {
  registerParentSchema,
  loginParentSchema,
  refreshSchema,
  verifyEmailSchema,
  childLoginSchema,
  updateChildCredentialsSchema,
  reauthSchema,
  completeDobSchema,
} from "./auth.schema.js";

const router = Router();

// Per-endpoint rate limits (tighter than the global one)
// In test mode, use a high limit so tests don't hit the rate limiter
const isTest = process.env["NODE_ENV"] === "test";

function authLimiter(max: number, windowMs = 15 * 60 * 1000) {
  return rateLimit({
    windowMs,
    max: isTest ? 10_000 : max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: "RATE_LIMITED", message: "Too many requests, try later" },
      });
    },
  });
}

// ── US1: Parent auth ──────────────────────────────────────────────────────────

router.post(
  "/auth/parent/register",
  authLimiter(10),
  validate(registerParentSchema),
  controller.registerParent,
);

router.post(
  "/auth/parent/login",
  authLimiter(20),
  validate(loginParentSchema),
  controller.loginParent,
);

router.post("/auth/refresh", authLimiter(30), validate(refreshSchema), controller.refresh);

router.post("/auth/logout", requireAuth, controller.logout);

router.get("/auth/me", requireAuth, controller.getMe);

router.get("/auth/email/verify", validate(verifyEmailSchema), controller.verifyEmail);

// ── US2: Child auth ───────────────────────────────────────────────────────────

router.post(
  "/auth/child/login",
  authLimiter(20),
  validate(childLoginSchema),
  controller.loginChild,
);

// ── US4: Credential reset (parent-only, guarded) ──────────────────────────────

router.patch(
  "/parents/children/:childId/credentials",
  requireAuth,
  requireRole("parent"),
  requirePermission("child.credentials"),
  validate(updateChildCredentialsSchema),
  controller.updateChildCredentials,
);

// ── US5: Shared device ────────────────────────────────────────────────────────

// The child picker is scoped to the authenticated principal's family — the
// family is never taken from the request, so it can't be used to enumerate
// other families' children.
router.get(
  "/auth/shared/children",
  requireAuth,
  requireRole("parent"),
  controller.listSharedChildren,
);

router.post(
  "/auth/shared/reauth",
  authLimiter(20),
  requireAuth,
  requireRole("parent"),
  validate(reauthSchema),
  controller.reauthParent,
);

// ── US6: OAuth ────────────────────────────────────────────────────────────────

router.get("/auth/oauth/:provider/start", (_req, res) => {
  res
    .status(501)
    .json({ error: { code: "NOT_IMPLEMENTED", message: "Configure OAuth credentials to enable" } });
});

router.get("/auth/oauth/:provider/callback", oauthCallbackAuth, controller.oauthCallback);

router.post(
  "/auth/oauth/complete-dob",
  authLimiter(10),
  validate(completeDobSchema),
  controller.completeDob,
);

export default router;
