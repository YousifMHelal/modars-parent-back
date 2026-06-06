import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole, requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./billing.controller.js";
import {
  initiateSchema,
  overflowUpgradeSchema,
  planChangeSchema,
  paymentMethodSchema,
  invoiceParamSchema,
} from "./billing.schema.js";

// Parent-facing billing routes (contracts/billing.openapi.yaml, data-model.md §4).
// familyId is derived from the principal; child tokens are rejected at requireRole (403).
//
//   - Owner-only mutations (billing.manage): initiate, overflow-upgrade, plan-change,
//     payment-method, cancel, reactivate. A co-parent lacks billing.manage → 403.
//   - Reads (dashboard.view, owner + co-parent): history, invoice/:id.
//
// Activation/upgrade/extension never happen here — only the webhook drives status.

const router = Router();

// ── Owner-only writes (billing.manage) ────────────────────────────────────────

router.post(
  "/billing/initiate",
  requireAuth,
  requireRole("parent"),
  requirePermission("billing.manage"),
  validate(initiateSchema),
  controller.initiate,
);

router.post(
  "/billing/overflow-upgrade",
  requireAuth,
  requireRole("parent"),
  requirePermission("billing.manage"),
  validate(overflowUpgradeSchema),
  controller.overflowUpgrade,
);

router.post(
  "/billing/plan-change",
  requireAuth,
  requireRole("parent"),
  requirePermission("billing.manage"),
  validate(planChangeSchema),
  controller.planChange,
);

router.patch(
  "/billing/payment-method",
  requireAuth,
  requireRole("parent"),
  requirePermission("billing.manage"),
  validate(paymentMethodSchema),
  controller.changePaymentMethod,
);

router.post(
  "/billing/cancel",
  requireAuth,
  requireRole("parent"),
  requirePermission("billing.manage"),
  controller.cancel,
);

router.post(
  "/billing/reactivate",
  requireAuth,
  requireRole("parent"),
  requirePermission("billing.manage"),
  controller.reactivate,
);

// ── Reads (dashboard.view — owner + co-parent) ────────────────────────────────

router.get(
  "/billing/history",
  requireAuth,
  requireRole("parent"),
  requirePermission("dashboard.view"),
  controller.getBillingHistory,
);

router.get(
  "/billing/invoice/:id",
  requireAuth,
  requireRole("parent"),
  requirePermission("dashboard.view"),
  validate(invoiceParamSchema),
  controller.getInvoice,
);

export default router;
