import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole, requirePermission } from "../../middleware/requirePermission.js";
import * as controller from "./files.controller.js";

const router = Router();

// Family-scoped object retrieval (contracts/files.openapi.yaml). requireAuth establishes
// the principal; the service enforces the family-ownership check (regardless of role) and
// returns a signed redirect (S3/R2) or a byte stream (local). No public static exposure.

router.get("/files/login-cards/:childId", requireAuth, controller.getLoginCard);

router.get("/files/attachments/:messageId/:filename", requireAuth, controller.getAttachment);

// Export bundles carry the whole family's data — parent-only (account.settings), unlike
// login cards/attachments which any in-family principal may fetch (Phase 8, FR-003).
router.get(
  "/files/exports/:exportId",
  requireAuth,
  requireRole("parent"),
  requirePermission("account.settings"),
  controller.getExport,
);

export default router;
