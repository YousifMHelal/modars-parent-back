import crypto from "crypto";
import prisma from "../../db/prisma.js";
import { AppError, ErrorCode, ConflictError, NotFoundError } from "../../lib/errors.js";
import { hashSecret } from "../../lib/hashing.js";
import * as mailer from "../../lib/mailer.js";
import { issueSessionPair, type TokenPair } from "../auth/auth.service.js";
import type {
  AccountUpdateInput,
  NotificationPrefsInput,
  AcceptInput,
} from "./settings.schema.js";

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
  const result = await prisma.parent.updateMany({
    where: { id: parentId, familyId },
    data: {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.phoneCountry !== undefined ? { phoneCountry: input.phoneCountry } : {}),
      ...(input.phoneNumber !== undefined ? { phoneNumber: input.phoneNumber } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
    },
  });
  if (result.count === 0) throw new NotFoundError("Account not found");
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
