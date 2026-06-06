import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole, requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { publicWriteLimiter } from "../../middleware/writeRateLimit.js";
import * as controller from "./children.controller.js";
import {
  createChildSchema,
  editChildSchema,
  credentialsSchema,
  usernameCheckSchema,
  childActionSchema,
} from "./children.schema.js";

const router = Router();

// Every write: requireAuth → requireRole("parent") → requirePermission(action) → validate.
// familyId is derived from the principal; child tokens are rejected at requireRole (403).
// delete / restore are owner-only via children.delete.

router.post(
  "/children",
  requireAuth,
  requireRole("parent"),
  requirePermission("children.create"),
  validate(createChildSchema),
  controller.createChild,
);

router.get(
  "/children/username-available",
  publicWriteLimiter(30),
  requireAuth,
  requireRole("parent"),
  requirePermission("children.create"),
  validate(usernameCheckSchema),
  controller.checkUsername,
);

router.patch(
  "/children/:childId",
  requireAuth,
  requireRole("parent"),
  requirePermission("children.edit"),
  validate(editChildSchema),
  controller.editChild,
);

router.patch(
  "/children/:childId/credentials",
  requireAuth,
  requireRole("parent"),
  requirePermission("child.credentials"),
  validate(credentialsSchema),
  controller.updateCredentials,
);

router.post(
  "/children/:childId/pause",
  requireAuth,
  requireRole("parent"),
  requirePermission("children.pause"),
  validate(childActionSchema),
  controller.pauseChild,
);

router.post(
  "/children/:childId/reactivate",
  requireAuth,
  requireRole("parent"),
  requirePermission("children.pause"),
  validate(childActionSchema),
  controller.reactivateChild,
);

router.delete(
  "/children/:childId",
  requireAuth,
  requireRole("parent"),
  requirePermission("children.delete"),
  validate(childActionSchema),
  controller.deleteChild,
);

router.post(
  "/children/:childId/restore",
  requireAuth,
  requireRole("parent"),
  requirePermission("children.delete"),
  validate(childActionSchema),
  controller.restoreChild,
);

export default router;
