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
  deleteConfirmSchema,
  exportIdParamSchema,
  consentQuerySchema,
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

// ── Phase 8: account deletion (owner-only family.delete; rate-limited) ─────────

router.post(
  "/settings/account/delete",
  requireAuth,
  requireRole("parent"),
  requirePermission("family.delete"),
  validate(deleteConfirmSchema),
  publicWriteLimiter(10),
  controller.requestAccountDeletion,
);

router.post(
  "/settings/account/delete/cancel",
  requireAuth,
  requireRole("parent"),
  requirePermission("family.delete"),
  publicWriteLimiter(10),
  controller.cancelAccountDeletion,
);

// ── Phase 8: data export (owner-only account.settings) ────────────────────────

router.post(
  "/settings/account/export",
  requireAuth,
  requireRole("parent"),
  requirePermission("account.settings"),
  publicWriteLimiter(10),
  controller.requestDataExport,
);

router.get(
  "/settings/account/export",
  requireAuth,
  requireRole("parent"),
  requirePermission("account.settings"),
  controller.listDataExports,
);

router.get(
  "/settings/account/export/:id",
  requireAuth,
  requireRole("parent"),
  requirePermission("account.settings"),
  validate(exportIdParamSchema),
  controller.getDataExport,
);

// ── Phase 8: consent history (owner-only account.settings) ────────────────────

router.get(
  "/settings/consent",
  requireAuth,
  requireRole("parent"),
  requirePermission("account.settings"),
  validate(consentQuerySchema),
  controller.getConsentHistory,
);

export default router;
