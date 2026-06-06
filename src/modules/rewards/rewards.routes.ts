import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole, requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./rewards.controller.js";
import {
  createRewardSchema,
  editRewardSchema,
  listRewardsSchema,
  rewardActionSchema,
} from "./rewards.schema.js";

const router = Router();

// Every reward route: requireAuth → requireRole("parent") → requirePermission → validate,
// mirroring children.routes.ts. familyId is derived from the principal; child tokens are
// rejected at requireRole (403). Reads use rewards.view; writes use rewards.manage.

router.post(
  "/rewards",
  requireAuth,
  requireRole("parent"),
  requirePermission("rewards.manage"),
  validate(createRewardSchema),
  controller.createReward,
);

router.get(
  "/rewards",
  requireAuth,
  requireRole("parent"),
  requirePermission("rewards.view"),
  validate(listRewardsSchema),
  controller.listRewards,
);

router.get(
  "/rewards/:rewardId",
  requireAuth,
  requireRole("parent"),
  requirePermission("rewards.view"),
  validate(rewardActionSchema),
  controller.getReward,
);

router.patch(
  "/rewards/:rewardId",
  requireAuth,
  requireRole("parent"),
  requirePermission("rewards.manage"),
  validate(editRewardSchema),
  controller.editReward,
);

router.post(
  "/rewards/:rewardId/fulfill",
  requireAuth,
  requireRole("parent"),
  requirePermission("rewards.manage"),
  validate(rewardActionSchema),
  controller.fulfillReward,
);

export default router;
