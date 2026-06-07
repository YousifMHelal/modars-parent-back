import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole, requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./homework.controller.js";
import { createHomeworkSchema } from "./homework.schema.js";

const router = Router();

// Parent-authored homework creation. requireAuth → requireRole("parent") →
// requirePermission("homework.manage") → validate. familyId is derived from the
// principal; child tokens are rejected at requireRole (403). status is never accepted
// from the client (server-authoritative, FR-017).
router.post(
  "/children/:childId/homework",
  requireAuth,
  requireRole("parent"),
  requirePermission("homework.manage"),
  validate(createHomeworkSchema),
  controller.createHomework,
);

export default router;
