import type { PrincipalRole } from "../../lib/jwt.js";

// Permission matrix per research.md §8
// ⚠ Default values — reconcile against SRS §7 when available

export type Action =
  | "dashboard.view"
  | "children.view"
  | "children.create"
  | "children.edit"
  | "children.delete"
  | "children.pause"
  | "child.credentials"
  | "progress.view"
  | "billing.manage"
  | "co_parent.manage"
  | "account.settings"
  | "family.delete"
  | "rewards.view"
  | "rewards.manage"
  | "homework.manage"
  | "child.session";

const MATRIX: Record<Action, Set<PrincipalRole>> = {
  "dashboard.view": new Set(["owner", "co_parent"]),
  "children.view": new Set(["owner", "co_parent"]),
  "children.create": new Set(["owner", "co_parent"]),
  "children.edit": new Set(["owner", "co_parent"]),
  "children.delete": new Set(["owner"]),
  "children.pause": new Set(["owner", "co_parent"]),
  "child.credentials": new Set(["owner", "co_parent"]),
  "progress.view": new Set(["owner", "co_parent"]),
  "billing.manage": new Set(["owner"]),
  "co_parent.manage": new Set(["owner"]),
  "account.settings": new Set(["owner"]),
  "family.delete": new Set(["owner"]),
  "rewards.view": new Set(["owner", "co_parent"]),
  "rewards.manage": new Set(["owner", "co_parent"]),
  "homework.manage": new Set(["owner", "co_parent"]),
  "child.session": new Set(["child"]),
};

export function can(role: PrincipalRole, action: Action): boolean {
  return MATRIX[action]?.has(role) ?? false;
}
