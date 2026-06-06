import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { publicWriteLimiter } from "../../middleware/writeRateLimit.js";
import * as controller from "./onboarding.controller.js";
import { registerSchema, planSelectionSchema } from "./onboarding.schema.js";

const router = Router();

// Register is public (per-endpoint rate limited). Plan + state are behind
// requireAuth → requireRole("parent"); familyId is derived from the principal.

router.post(
  "/onboarding/register",
  publicWriteLimiter(10),
  validate(registerSchema),
  controller.register,
);

router.put(
  "/onboarding/plan",
  requireAuth,
  requireRole("parent"),
  validate(planSelectionSchema),
  controller.selectPlan,
);

router.get("/onboarding/state", requireAuth, requireRole("parent"), controller.getState);

export default router;
