import crypto from "crypto";
import { gzipSync } from "node:zlib";
import pino from "pino";
import prisma from "../../db/prisma.js";
import config from "../../config/index.js";
import { Prisma, type DataExport } from "../../generated/prisma/client.js";
import {
  AppError,
  ErrorCode,
  ConflictError,
  NotFoundError,
  ExportExpiredError,
} from "../../lib/errors.js";
import { hashSecret, verifySecret } from "../../lib/hashing.js";
import * as mailer from "../../lib/mailer.js";
import storage from "../../lib/storage.js";
import { exportKey, exportRef } from "../../lib/storageKeys.js";
import { dataExportQueue } from "../../jobs/queues.js";
import type { ConsentQueryInput } from "./settings.schema.js";
import { hardDeleteChildDependents } from "../children/children.service.js";
import { issueSessionPair, type TokenPair } from "../auth/auth.service.js";
import type {
  AccountUpdateInput,
  NotificationPrefsInput,
  AcceptInput,
  ChangePasswordInput,
} from "./settings.schema.js";

const logger = pino({ name: "settings.service" });

const DAY_MS = 24 * 60 * 60 * 1000;

// Sole Prisma toucher for settings writes. Account/prefs update the caller's own
// Parent row (familyId+parentId scoped); co-parent invite/accept/revoke manage the
// CoParentInvitation model with hashed single-use tokens (research.md §5).

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ── US3: account ──────────────────────────────────────────────────────────────

export async function updateAccount(
  familyId: string,
  parentId: string,
  input: AccountUpdateInput,
): Promise<void> {
  // Email is the login identity (unique across all parents). Reject a change to an
  // address already taken by a *different* parent before we attempt the write, so the
  // caller gets a clean 409 rather than a Prisma unique-constraint surprise (FR-026).
  if (input.email !== undefined) {
    const existing = await prisma.parent.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing && existing.id !== parentId) {
      throw new ConflictError("This email is already registered to a parent");
    }
  }

  const result = await prisma.parent.updateMany({
    where: { id: parentId, familyId },
    data: {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phoneCountry !== undefined ? { phoneCountry: input.phoneCountry } : {}),
      ...(input.phoneNumber !== undefined ? { phoneNumber: input.phoneNumber } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.language !== undefined ? { language: input.language } : {}),
    },
  });
  if (result.count === 0) throw new NotFoundError("Account not found");
}

/**
 * Change the calling parent's own password (owner-only). Guarded by the current password:
 * a wrong current password is a 401 (UNAUTHORIZED), indistinguishable from a real auth
 * failure. On success the new password is argon2-hashed and stored. Family-scoped so a
 * caller can only ever rotate their own credential.
 */
export async function changePassword(
  familyId: string,
  parentId: string,
  input: ChangePasswordInput,
): Promise<void> {
  const parent = await prisma.parent.findFirst({
    where: { id: parentId, familyId },
    select: { passwordHash: true },
  });
  if (!parent) throw new NotFoundError("Account not found");

  // A passwordless (OAuth-only) account cannot verify a current password.
  if (!parent.passwordHash) {
    throw new AppError(409, ErrorCode.CONFLICT, "This account has no password set");
  }

  const ok = await verifySecret(parent.passwordHash, input.currentPassword);
  if (!ok) throw new AppError(401, ErrorCode.UNAUTHORIZED, "Current password is incorrect");

  const passwordHash = await hashSecret(input.newPassword);
  await prisma.parent.update({
    where: { id: parentId },
    data: { passwordHash },
  });
}

export async function updateNotificationPrefs(
  familyId: string,
  parentId: string,
  input: NotificationPrefsInput,
): Promise<void> {
  const result = await prisma.parent.updateMany({
    where: { id: parentId, familyId },
    data: {
      ...(input.push !== undefined ? { notifyPush: input.push } : {}),
      ...(input.email !== undefined ? { notifyEmail: input.email } : {}),
      ...(input.whatsapp !== undefined ? { notifyWhatsapp: input.whatsapp } : {}),
    },
  });
  if (result.count === 0) throw new NotFoundError("Account not found");
}

// ── US4: co-parent invite / accept / revoke ───────────────────────────────────

export async function inviteCoParent(
  familyId: string,
  invitedById: string,
  email: string,
): Promise<void> {
  // FR-026: refuse if the email already belongs to any parent (single-family rule).
  const existing = await prisma.parent.findUnique({ where: { email } });
  if (existing) throw new ConflictError("This email is already registered to a parent");

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);

  await prisma.coParentInvitation.create({
    data: {
      familyId,
      invitedById,
      email,
      tokenHash,
      status: "PENDING",
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  const link = `${process.env["APP_URL"] ?? "http://localhost:4000"}/co-parent/accept?token=${encodeURIComponent(token)}`;
  mailer.send({
    to: email,
    subject: "You've been invited as a co-parent on Modrs.ai",
    text: `Accept your co-parent invitation: ${link}`,
    html: `<p>Accept your co-parent invitation <a href="${link}">here</a>.</p>`,
  });
}

export async function acceptCoParent(input: AcceptInput): Promise<TokenPair> {
  const tokenHash = hashToken(input.token);

  const invitation = await prisma.coParentInvitation.findFirst({
    where: { tokenHash, status: "PENDING" },
  });
  if (!invitation) {
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, "Invalid or used invitation token");
  }

  if (invitation.expiresAt < new Date()) {
    await prisma.coParentInvitation.update({
      where: { id: invitation.id },
      data: { status: "EXPIRED" },
    });
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, "Invitation has expired");
  }

  // 18+ gate (Principle IV).
  const dob = new Date(input.dateOfBirth);
  const age = (Date.now() - dob.getTime()) / (365.25 * 86400 * 1000);
  if (age < 18) throw new AppError(422, ErrorCode.VALIDATION_ERROR, "Must be 18 or older");

  // FR-026 re-check at acceptance time (email may have registered after the invite).
  const existing = await prisma.parent.findUnique({ where: { email: invitation.email } });
  if (existing) throw new ConflictError("This email is already registered to a parent");

  const passwordHash = await hashSecret(input.password);

  const parent = await prisma.$transaction(async (tx) => {
    const created = await tx.parent.create({
      data: {
        familyId: invitation.familyId,
        role: "CO_PARENT",
        fullName: input.fullName,
        email: invitation.email,
        passwordHash,
        dob,
      },
    });
    await tx.coParentInvitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    return created;
  });

  return issueSessionPair({
    principalId: parent.id,
    principalType: "parent",
    role: "co_parent",
    familyId: parent.familyId,
  });
}

export async function revokeInvitation(familyId: string, id: string): Promise<void> {
  const invitation = await prisma.coParentInvitation.findFirst({
    where: { id, familyId },
  });
  if (!invitation) throw new NotFoundError("Invitation not found");

  if (invitation.status !== "PENDING") {
    throw new AppError(409, ErrorCode.CONFLICT, "Only pending invitations can be revoked");
  }

  await prisma.coParentInvitation.update({
    where: { id: invitation.id },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
}

// ── Phase 8: account-deletion state (data-model.md §A) ────────────────────────

export type DeletionStatus = "active" | "pending_deletion";

export interface DeletionState {
  status: DeletionStatus;
  deletedAt: Date | null;
  purgeAfter: Date | null;
}

/**
 * Pure: the purge deadline for a deletion stamped at `deletedAt`, given the configured
 * retain window (ACCOUNT_RETAIN_DAYS). Server-authoritative — the client never supplies it.
 */
export function computePurgeAfter(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + config.ACCOUNT_RETAIN_DAYS * DAY_MS);
}

/** Pure: map a family's deletion columns to the externally-reported state shape. */
export function toDeletionState(family: {
  deletedAt: Date | null;
  purgeAfter: Date | null;
}): DeletionState {
  return {
    status: family.deletedAt ? "pending_deletion" : "active",
    deletedAt: family.deletedAt,
    purgeAfter: family.purgeAfter,
  };
}

/** Read a family's current deletion state (family-scoped). */
export async function getDeletionState(familyId: string): Promise<DeletionState> {
  const family = await prisma.family.findUnique({
    where: { id: familyId },
    select: { deletedAt: true, purgeAfter: true },
  });
  if (!family) throw new NotFoundError("Family not found");
  return toDeletionState(family);
}

/**
 * Request deletion of the whole family account (FR-008/011). Stamps deletedAt/purgeAfter
 * (server-authoritative). Idempotent: re-requesting on an already-pending family is a
 * no-op that returns the existing purge date — the window is never reset/extended
 * (data-model.md §A). Access revocation is enforced in auth.service at the *request*, so
 * the caller can no longer authenticate after this returns.
 */
export async function requestAccountDeletion(familyId: string): Promise<DeletionState> {
  const family = await prisma.family.findUnique({
    where: { id: familyId },
    select: { deletedAt: true, purgeAfter: true },
  });
  if (!family) throw new NotFoundError("Family not found");

  // Already pending → no-op, return the existing window (idempotent, no reset).
  if (family.deletedAt) return toDeletionState(family);

  const deletedAt = new Date();
  const purgeAfter = computePurgeAfter(deletedAt);
  const [updated] = await prisma.$transaction([
    prisma.family.update({
      where: { id: familyId },
      data: { deletedAt, purgeAfter },
      select: { deletedAt: true, purgeAfter: true },
    }),
    // Revoke every live session in the family so already-minted access tokens stop
    // working immediately (FR-014) — not just future login/refresh.
    prisma.authSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: deletedAt },
    }),
  ]);
  return toDeletionState(updated);
}

/**
 * Cancel a pending deletion within the retain window (FR-009), restoring access with zero
 * data loss. Only valid while purgeAfter > now (a family already past its window — or
 * already purged — cannot be restored). Clears deletedAt/purgeAfter together.
 */
export async function cancelAccountDeletion(familyId: string): Promise<DeletionState> {
  const family = await prisma.family.findUnique({
    where: { id: familyId },
    select: { deletedAt: true, purgeAfter: true },
  });
  if (!family) throw new NotFoundError("Family not found");

  if (!family.deletedAt || !family.purgeAfter) {
    throw new AppError(409, ErrorCode.CONFLICT, "Account is not pending deletion");
  }
  if (family.purgeAfter.getTime() <= Date.now()) {
    throw new AppError(409, ErrorCode.CONFLICT, "The deletion window has elapsed");
  }

  const updated = await prisma.family.update({
    where: { id: familyId },
    data: { deletedAt: null, purgeAfter: null },
    select: { deletedAt: true, purgeAfter: true },
  });
  return toDeletionState(updated);
}

// ── Phase 8: family purge sweep (research.md §2/§3, contracts/job-payloads.md §1) ──

/**
 * Permanently remove families whose retain window has elapsed (deletedAt != null AND
 * purgeAfter <= now). Each candidate is re-checked inside its own transaction so a cancel
 * between scan and now excludes it (FR-009/013). Deletes the family graph in FK-safe order
 * (every relation is onDelete: Restrict), composing the per-child helper, then family-level
 * rows, then parents, then the Family — which releases child usernames via the unique
 * constraint. Invoices/consent younger than their legal-retain minimum are anonymized-and-
 * kept (FR-010). Idempotent: a P2025 (already gone) is tolerated. Returns purged ids.
 */
export async function purgeDueDeletedFamilies(now: Date = new Date()): Promise<string[]> {
  const due = await prisma.family.findMany({
    where: { deletedAt: { not: null }, purgeAfter: { lte: now } },
    select: { id: true },
  });

  const purged: string[] = [];
  for (const candidate of due) {
    try {
      await prisma.$transaction(async (tx) => {
        // Re-check in-tx: a cancel between the scan and now clears deletedAt/purgeAfter.
        const fresh = await tx.family.findFirst({
          where: { id: candidate.id, deletedAt: { not: null }, purgeAfter: { lte: now } },
          select: { id: true },
        });
        if (!fresh) return; // restored or already purged — skip

        await purgeFamilyGraph(tx, candidate.id, now);
      });
      purged.push(candidate.id);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        continue; // already gone — idempotent no-op
      }
      logger.warn({ err, familyId: candidate.id }, "family purge skipped (concurrent change)");
    }
  }

  if (purged.length > 0) {
    logger.info({ purgedCount: purged.length, purged }, "deleted families purged");
  }
  return purged;
}

/**
 * Hard-delete one family's entire graph in FK-safe order (leaves → roots). Composes the
 * per-child dependent helper, then removes family-level rows, then parents, then the
 * Family itself. Legal-retain invoices/consent are anonymized-and-kept (detached from the
 * family) instead of deleted. Runs inside the caller's transaction.
 */
async function purgeFamilyGraph(
  tx: Prisma.TransactionClient,
  familyId: string,
  now: Date,
): Promise<void> {
  // 1. Per-child dependents + children (FK-safe ordering reused from children.service).
  const children = await tx.child.findMany({ where: { familyId }, select: { id: true } });
  for (const child of children) {
    await hardDeleteChildDependents(tx, child.id);
  }
  await tx.child.deleteMany({ where: { familyId } });

  // 2. Family-level rows not owned by a child. Order clears FK leaves before parents.
  // Conversations have Message children (onDelete: Restrict) — clear messages first.
  const conversations = await tx.conversation.findMany({
    where: { familyId },
    select: { id: true },
  });
  const conversationIds = conversations.map((c) => c.id);
  if (conversationIds.length > 0) {
    await tx.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
  }
  await tx.conversation.deleteMany({ where: { familyId } });

  await tx.notification.deleteMany({ where: { familyId } });
  await tx.reminderConfig.deleteMany({ where: { familyId } });
  await tx.homework.deleteMany({ where: { familyId } });
  await tx.session.deleteMany({ where: { familyId } });
  await tx.badge.deleteMany({ where: { familyId } });
  await tx.reward.deleteMany({ where: { familyId } });
  // SubjectProgress has TopicProgress children (onDelete: Restrict) — clear topics first.
  const subjectProgress = await tx.subjectProgress.findMany({
    where: { familyId },
    select: { id: true },
  });
  const subjectProgressIds = subjectProgress.map((s) => s.id);
  if (subjectProgressIds.length > 0) {
    await tx.topicProgress.deleteMany({
      where: { subjectProgressId: { in: subjectProgressIds } },
    });
  }
  await tx.subjectProgress.deleteMany({ where: { familyId } });
  await tx.pushToken.deleteMany({ where: { familyId } });
  await tx.authSession.deleteMany({ where: { familyId } });
  await tx.coParentInvitation.deleteMany({ where: { familyId } });

  // 3. Billing rows: subscription → invoices/paymentIntents (FK-safe), with legal-retain.
  await tx.dataExport.deleteMany({ where: { familyId } });
  await tx.paymentMethod.deleteMany({ where: { familyId } });
  await tx.paymentIntent.deleteMany({ where: { familyId } });
  const subscription = await tx.subscription.findUnique({
    where: { familyId },
    select: { id: true },
  });
  if (subscription) {
    await purgeOrRetainInvoices(tx, subscription.id, now);
    await tx.subscription.delete({ where: { id: subscription.id } });
  }

  // 4. Consent: anonymize-and-keep within the legal-retain window, delete the rest.
  await purgeOrRetainConsent(tx, familyId, now);

  // 5. OAuth accounts + email-verification tokens hang off parents (onDelete: Cascade),
  //    so deleting parents removes them. Parents reference the family (Restrict).
  await tx.parent.deleteMany({ where: { familyId } });

  // 6. The family row last — its removal releases child usernames (already deleted above).
  await tx.family.delete({ where: { id: familyId } });
}

/**
 * Invoices younger than INVOICE_LEGAL_RETAIN_DAYS are detached-and-kept (subscription link
 * severed via a tombstone), the rest deleted. Default retain=0 → delete all with the family.
 */
async function purgeOrRetainInvoices(
  tx: Prisma.TransactionClient,
  subscriptionId: string,
  now: Date,
): Promise<void> {
  const retainDays = config.INVOICE_LEGAL_RETAIN_DAYS;
  if (retainDays <= 0) {
    await tx.invoice.deleteMany({ where: { subscriptionId } });
    return;
  }
  const cutoff = new Date(now.getTime() - retainDays * DAY_MS);
  // Older than the retain window → delete with the family.
  await tx.invoice.deleteMany({ where: { subscriptionId, issuedAt: { lt: cutoff } } });
  // Younger → must outlive the subscription delete; re-home onto a retained tombstone sub.
  const retained = await tx.invoice.findMany({
    where: { subscriptionId, issuedAt: { gte: cutoff } },
    select: { id: true },
  });
  if (retained.length > 0) {
    const tombstone = await ensureRetentionTombstone(tx);
    await tx.invoice.updateMany({
      where: { id: { in: retained.map((i) => i.id) } },
      data: { subscriptionId: tombstone },
    });
  }
}

/**
 * Consent records younger than CONSENT_LEGAL_RETAIN_DAYS are anonymized-and-kept (family/
 * parent/child references detached) so the minimal consent fact survives; older ones are
 * deleted. Default retain=0 → delete all with the family.
 */
async function purgeOrRetainConsent(
  tx: Prisma.TransactionClient,
  familyId: string,
  now: Date,
): Promise<void> {
  const retainDays = config.CONSENT_LEGAL_RETAIN_DAYS;
  if (retainDays <= 0) {
    await tx.consentRecord.deleteMany({ where: { familyId } });
    return;
  }
  const cutoff = new Date(now.getTime() - retainDays * DAY_MS);
  await tx.consentRecord.deleteMany({ where: { familyId, grantedAt: { lt: cutoff } } });
  const retained = await tx.consentRecord.findMany({
    where: { familyId, grantedAt: { gte: cutoff } },
    select: { id: true },
  });
  if (retained.length > 0) {
    const tombstone = await ensureRetentionFamily(tx);
    // Detach parent/child (deleted with the family) and re-home onto the tombstone family.
    await tx.consentRecord.updateMany({
      where: { id: { in: retained.map((c) => c.id) } },
      data: { familyId: tombstone, parentId: null, childId: null },
    });
  }
}

// A single shared tombstone Family/Subscription holds legally-retained, anonymized records
// after their owning family is purged. Created lazily and reused (idempotent upsert).
const RETENTION_FAMILY_ID = "legal-retention-tombstone";

async function ensureRetentionFamily(tx: Prisma.TransactionClient): Promise<string> {
  await tx.family.upsert({
    where: { id: RETENTION_FAMILY_ID },
    update: {},
    create: { id: RETENTION_FAMILY_ID, name: "[legal retention]" },
  });
  return RETENTION_FAMILY_ID;
}

async function ensureRetentionTombstone(tx: Prisma.TransactionClient): Promise<string> {
  const familyId = await ensureRetentionFamily(tx);
  const existing = await tx.subscription.findUnique({
    where: { familyId },
    select: { id: true },
  });
  if (existing) return existing.id;

  // The tombstone needs a Plan to satisfy the FK; reuse any existing plan.
  const plan = await tx.plan.findFirst({ select: { id: true } });
  if (!plan) {
    // No plan in the system → cannot retain invoices; fall back to keeping them detached
    // is impossible without a subscription, so surface clearly rather than silently drop.
    throw new AppError(
      500,
      ErrorCode.INTERNAL_ERROR,
      "Cannot retain invoices: no Plan exists for the retention tombstone",
    );
  }
  const sub = await tx.subscription.create({
    data: {
      familyId,
      planId: plan.id,
      status: "CANCELED",
      billingCycle: "MONTHLY",
      currentPeriodEnd: new Date(0),
    },
    select: { id: true },
  });
  return sub.id;
}

// ── Phase 8: data export (research.md §4, data-model.md §B/§C) ─────────────────

export interface DataExportView {
  id: string;
  status: DataExport["status"];
  requestedAt: Date;
  readyAt: Date | null;
  expiresAt: Date | null;
  downloadRef: string | null;
}

/** Map a DataExport row to its API view, exposing a downloadRef only when retrievable. */
function toExportView(row: DataExport, now: Date = new Date()): DataExportView {
  const retrievable =
    row.status === "READY" && row.expiresAt !== null && row.expiresAt.getTime() > now.getTime();
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt,
    readyAt: row.readyAt,
    expiresAt: row.expiresAt,
    downloadRef: retrievable ? exportRef(row.id) : null,
  };
}

/**
 * Create a PENDING export and enqueue assembly (FR-001). Family-scoped: the row is owned by
 * the principal's family and attributed to the requesting parent. Returns the view to poll.
 */
export async function requestDataExport(
  familyId: string,
  parentId: string,
): Promise<DataExportView> {
  const row = await prisma.dataExport.create({
    data: { familyId, requestedByParentId: parentId, status: "PENDING" },
  });
  await dataExportQueue().add("assemble", { exportId: row.id, familyId });
  return toExportView(row);
}

/** List the family's exports, newest first (family-scoped). */
export async function listDataExports(familyId: string): Promise<DataExportView[]> {
  const rows = await prisma.dataExport.findMany({
    where: { familyId },
    orderBy: { requestedAt: "desc" },
  });
  const now = new Date();
  return rows.map((r) => toExportView(r, now));
}

/**
 * Read one export (family-scoped). A foreign/unknown id is a 404 (non-enumerable). A READY
 * export past its TTL is a 410 (FR-003/004).
 */
export async function getDataExport(familyId: string, id: string): Promise<DataExportView> {
  const row = await prisma.dataExport.findFirst({ where: { id, familyId } });
  if (!row) throw new NotFoundError("Export not found");
  if (row.status === "EXPIRED") throw new ExportExpiredError();
  if (row.status === "READY" && row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    throw new ExportExpiredError();
  }
  return toExportView(row);
}

/**
 * Resolve a READY, unexpired export's storage key for the family-scoped /files proxy.
 * A foreign/unknown id is a 404; an expired/not-ready export is a 410/404 (FR-003/004).
 */
export async function resolveExportStorageKey(familyId: string, id: string): Promise<string> {
  const row = await prisma.dataExport.findFirst({ where: { id, familyId } });
  if (!row) throw new NotFoundError("Export not found");
  if (row.status === "EXPIRED") throw new ExportExpiredError();
  if (row.status !== "READY" || !row.storageKey) throw new NotFoundError("Export not ready");
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) throw new ExportExpiredError();
  return row.storageKey;
}

/**
 * Assemble + gzip + store the family-scoped export bundle (data-model.md §C), then flip the
 * row to READY with storageKey/readyAt/expiresAt. On error sets FAILED/error. Idempotent: a
 * non-PENDING export is a no-op; a retry re-puts the same key (research.md §4,
 * contracts/job-payloads.md §2).
 */
export async function assembleDataExport(exportId: string): Promise<void> {
  const row = await prisma.dataExport.findUnique({ where: { id: exportId } });
  if (!row || row.status !== "PENDING") return; // already handled or gone — idempotent

  try {
    const bundle = await buildExportBundle(row.familyId, exportId);
    const bytes = gzipSync(Buffer.from(JSON.stringify(bundle)));
    const key = exportKey(row.familyId, exportId);
    await storage.put(key, bytes, "application/gzip");

    const readyAt = new Date();
    const expiresAt = new Date(readyAt.getTime() + config.DATA_EXPORT_TTL * 1000);
    await prisma.dataExport.update({
      where: { id: exportId },
      data: { status: "READY", storageKey: key, readyAt, expiresAt },
    });
    logger.info({ exportId, familyId: row.familyId }, "data export ready");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.dataExport.update({
      where: { id: exportId },
      data: { status: "FAILED", error: message },
    });
    logger.error({ err, exportId }, "data export failed");
  }
}

/**
 * Expire READY exports past their TTL (folded into the hourly sweep, job-payloads §3): flip to
 * EXPIRED and delete the bytes. Idempotent: a missing object on delete is tolerated.
 */
export async function expireDueExports(now: Date = new Date()): Promise<string[]> {
  const due = await prisma.dataExport.findMany({
    where: { status: "READY", expiresAt: { lte: now } },
    select: { id: true, storageKey: true },
  });
  const expired: string[] = [];
  for (const row of due) {
    try {
      if (row.storageKey) {
        await deleteStoredObject(row.storageKey);
      }
      await prisma.dataExport.update({ where: { id: row.id }, data: { status: "EXPIRED" } });
      expired.push(row.id);
    } catch (err) {
      logger.warn({ err, exportId: row.id }, "export expire skipped");
    }
  }
  if (expired.length > 0) logger.info({ expiredCount: expired.length }, "expired exports cleaned");
  return expired;
}

/** Best-effort delete of a stored object across backends (local file or S3 key). */
async function deleteStoredObject(key: string): Promise<void> {
  const maybeDelete = (storage as { delete?: (k: string) => Promise<void> }).delete;
  if (typeof maybeDelete === "function") {
    await maybeDelete(key);
    return;
  }
  // Local backend has no delete in the interface; remove the file directly (dev only).
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await fs.unlink(path.join(config.STORAGE_DIR, key.replace(/\.\.+/g, "").replace(/^\/+/, "")));
  } catch {
    // Missing object is fine (idempotent).
  }
}

/**
 * Build the family-scoped export document covering every FR-002 category, with secrets and
 * hashes excluded (data-model.md §C). Only this family's rows appear (FR-004).
 */
async function buildExportBundle(familyId: string, exportId: string): Promise<unknown> {
  const [
    family,
    parents,
    children,
    subjectProgress,
    topicProgress,
    struggleTrackers,
    badges,
    sessions,
    homework,
    rewards,
    reminderConfigs,
    notifications,
    subscription,
    invoices,
    paymentMethods,
    paymentIntents,
    consentRecords,
  ] = await Promise.all([
    prisma.family.findUnique({ where: { id: familyId } }),
    prisma.parent.findMany({ where: { familyId } }),
    prisma.child.findMany({ where: { familyId } }),
    prisma.subjectProgress.findMany({ where: { familyId } }),
    prisma.topicProgress.findMany({ where: { subjectProgress: { familyId } } }),
    prisma.struggleTracker.findMany({ where: { familyId } }),
    prisma.badge.findMany({ where: { familyId } }),
    prisma.session.findMany({ where: { familyId } }),
    prisma.homework.findMany({ where: { familyId } }),
    prisma.reward.findMany({ where: { familyId } }),
    prisma.reminderConfig.findMany({ where: { familyId } }),
    prisma.notification.findMany({ where: { familyId } }),
    prisma.subscription.findUnique({ where: { familyId } }),
    prisma.invoice.findMany({ where: { subscription: { familyId } } }),
    prisma.paymentMethod.findMany({ where: { familyId } }),
    prisma.paymentIntent.findMany({ where: { familyId } }),
    prisma.consentRecord.findMany({ where: { familyId } }),
  ]);

  // Exclusions (privacy/security, data-model §C): drop password/PIN hashes, tokens, secrets,
  // full card numbers, raw provider keys.
  const safeParents = parents.map(({ passwordHash: _p, ...rest }) => rest);
  const safeChildren = children.map(({ passwordHash: _p, pinHash: _pin, ...rest }) => rest);
  const safePaymentMethods = paymentMethods.map(
    ({ providerMethodRef: _r, ...rest }) => rest, // keep brand/last4/exp; drop provider token
  );
  const safePaymentIntents = paymentIntents.map(
    ({ providerRef: _r, ...rest }) => rest, // drop provider charge ref
  );

  return {
    meta: { exportId, familyId, generatedAt: new Date().toISOString(), version: "1" },
    account: { family, parents: safeParents },
    children: safeChildren,
    progress: { subjectProgress, topicProgress, struggleTrackers, badges },
    sessions,
    homework,
    rewards,
    reminders: { reminderConfigs, notifications },
    billing: {
      subscription,
      invoices,
      paymentMethods: safePaymentMethods,
      paymentIntents: safePaymentIntents,
    },
    consent: consentRecords,
  };
}

// ── Phase 8: consent history (FR-005/006) ─────────────────────────────────────

export interface ConsentRecordView {
  id: string;
  type: string;
  version: string;
  parentId: string | null;
  childId: string | null;
  grantedAt: Date;
}

/**
 * The family's consent history, newest first (family-scoped, full append-only history).
 * Optional `type`/`childId` filters. Re-consent appends, so older records remain visible.
 */
export async function getConsentHistory(
  familyId: string,
  query: ConsentQueryInput,
): Promise<ConsentRecordView[]> {
  const rows = await prisma.consentRecord.findMany({
    where: {
      familyId,
      ...(query.type !== undefined ? { type: query.type } : {}),
      ...(query.childId !== undefined ? { childId: query.childId } : {}),
    },
    orderBy: [{ grantedAt: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    version: r.version,
    parentId: r.parentId,
    childId: r.childId,
    grantedAt: r.grantedAt,
  }));
}
