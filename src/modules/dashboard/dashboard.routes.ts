import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole, requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./dashboard.controller.js";
import { childIdParamSchema } from "./dashboard.schema.js";

const router = Router();

// Every dashboard read: requireAuth → requireRole("parent") → requirePermission(action),
// scoped to the verified principal's familyId (research.md §1). Child tokens are
// rejected with 403 before any data access (Principle IV).

router.get(
  "/dashboard/home",
  requireAuth,
  requireRole("parent"),
  requirePermission("dashboard.view"),
  controller.getHome,
);

router.get(
  "/dashboard/children",
  requireAuth,
  requireRole("parent"),
  requirePermission("children.view"),
  controller.getChildren,
);

router.get(
  "/dashboard/children/:childId",
  requireAuth,
  requireRole("parent"),
  requirePermission("progress.view"),
  validate({ params: childIdParamSchema }),
  controller.getChildProfile,
);

router.get(
  "/dashboard/reminders",
  requireAuth,
  requireRole("parent"),
  requirePermission("dashboard.view"),
  controller.getReminders,
);

// Settings READ guards on dashboard.view (co-parent allowed); account.settings stays
// reserved for the Phase 4 settings writes (research.md §1 note).
router.get(
  "/dashboard/settings",
  requireAuth,
  requireRole("parent"),
  requirePermission("dashboard.view"),
  controller.getSettings,
);

export default router;
