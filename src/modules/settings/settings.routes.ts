import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole, requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { publicWriteLimiter } from "../../middleware/writeRateLimit.js";
import * as controller from "./settings.controller.js";
import {
  accountUpdateSchema,
  notificationPrefsSchema,
  inviteSchema,
  acceptSchema,
  revokeSchema,
} from "./settings.schema.js";

const router = Router();

// Account / prefs / invite / revoke are OWNER-only (account.settings / co_parent.manage).
// Accept is public + token-authenticated (per-endpoint rate limited).

router.patch(
  "/settings/account",
  requireAuth,
  requireRole("parent"),
  requirePermission("account.settings"),
  validate(accountUpdateSchema),
  controller.updateAccount,
);

router.patch(
  "/settings/notifications",
  requireAuth,
  requireRole("parent"),
  requirePermission("account.settings"),
  validate(notificationPrefsSchema),
  controller.updateNotificationPrefs,
);

router.post(
  "/settings/co-parent/invite",
  requireAuth,
  requireRole("parent"),
  requirePermission("co_parent.manage"),
  validate(inviteSchema),
  controller.inviteCoParent,
);

router.post(
  "/settings/co-parent/:id/revoke",
  requireAuth,
  requireRole("parent"),
  requirePermission("co_parent.manage"),
  validate(revokeSchema),
  controller.revokeInvitation,
);

router.post(
  "/co-parent/accept",
  publicWriteLimiter(20),
  validate(acceptSchema),
  controller.acceptCoParent,
);

export default router;
