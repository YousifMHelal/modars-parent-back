import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./notifications.controller.js";
import { registerPushTokenSchema, deregisterPushTokenSchema } from "./notifications.schema.js";

// Push-token registration — the only new HTTP surface in Phase 6
// (contracts/push-registration.openapi.yaml). Auth-gated by the existing middleware;
// BOTH parent and child sessions may register (a child registers its own device token),
// so we gate on requireAuth only and derive family/owner from the verified principal
// (Principle I) — never from the body.

const router = Router();

router.post(
  "/notifications/push-tokens",
  requireAuth,
  validate(registerPushTokenSchema),
  controller.registerPushToken,
);

router.delete(
  "/notifications/push-tokens",
  requireAuth,
  validate(deregisterPushTokenSchema),
  controller.deregisterPushToken,
);

// In-app notification feed for the parent dashboard bell. Parent-only: the feed lists
// PARENT-addressed notices and the family is derived from the verified principal.
router.get(
  "/notifications",
  requireAuth,
  requireRole("parent"),
  controller.listNotifications,
);

router.post(
  "/notifications/read-all",
  requireAuth,
  requireRole("parent"),
  controller.markAllNotificationsRead,
);

router.post(
  "/notifications/:id/read",
  requireAuth,
  requireRole("parent"),
  controller.markNotificationRead,
);

export default router;
