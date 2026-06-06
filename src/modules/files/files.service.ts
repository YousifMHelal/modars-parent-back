import type { ReadStream } from "node:fs";
import pino from "pino";
import prisma from "../../db/prisma.js";
import storage, { canSignRead } from "../../lib/storage.js";
import { ForbiddenError, NotFoundError, StorageUnavailableError } from "../../lib/errors.js";
import { loginCardKey, attachmentKey } from "../../lib/storageKeys.js";

const logger = pino({ name: "files.service" });

// Family-scoped object retrieval (research §7, Principle V). The principal's family must
// own the requested object, verified via the BACKING record (child for login cards, message
// for attachments) using family-scoped reads — never ambient state. Foreign/missing are an
// indistinguishable 404 where appropriate; an object owned by another family is a 403.
//
// On success the result is either a short-lived signed URL (S3/R2 backend) or a readable
// stream (local backend); the controller redirects or streams accordingly.

export type FileResult =
  | { kind: "signed"; url: string }
  | { kind: "stream"; stream: ReadStream; contentType: string };

async function resolve(key: string, contentType: string): Promise<FileResult> {
  try {
    if (canSignRead() && storage.signRead) {
      return { kind: "signed", url: await storage.signRead(key) };
    }
    if (storage.localStream) {
      return { kind: "stream", stream: storage.localStream(key), contentType };
    }
    throw new StorageUnavailableError();
  } catch (err) {
    if (err instanceof StorageUnavailableError) throw err;
    logger.error({ err, key }, "failed to resolve stored object");
    throw new StorageUnavailableError();
  }
}

/**
 * Authorize and resolve a child's login-card image. The child is loaded globally so an
 * object owned by ANOTHER family is a 403 (Principle V); an unknown child, a soft-deleted
 * child, or an in-family child without a card is a 404.
 */
export async function getLoginCard(familyId: string, childId: string): Promise<FileResult> {
  const child = await prisma.child.findUnique({
    where: { id: childId },
    select: { id: true, familyId: true, deletedAt: true, loginCardUrl: true },
  });

  if (!child || child.deletedAt) {
    throw new NotFoundError("Login card not found");
  }
  if (child.familyId !== familyId) {
    logger.warn({ familyId, childId, ownerFamilyId: child.familyId }, "cross-family login-card access denied");
    throw new ForbiddenError("This object belongs to another family");
  }
  if (!child.loginCardUrl) {
    throw new NotFoundError("Login card not found");
  }

  return resolve(loginCardKey(familyId, childId), "image/png");
}

/**
 * Authorize and resolve a message attachment. The message's family is resolved via its
 * conversation; another family's message is a 403, an unknown message or a filename that
 * doesn't match the stored attachment is a 404 (non-enumerable across families).
 */
export async function getAttachment(
  familyId: string,
  messageId: string,
  filename: string,
): Promise<FileResult> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, attachmentUrl: true, conversation: { select: { familyId: true } } },
  });

  if (!message || !message.attachmentUrl) {
    throw new NotFoundError("Attachment not found");
  }
  if (message.conversation.familyId !== familyId) {
    logger.warn({ familyId, messageId, ownerFamilyId: message.conversation.familyId }, "cross-family attachment access denied");
    throw new ForbiddenError("This object belongs to another family");
  }
  // The stored ref encodes the canonical filename; a guessed/mismatched name is a 404.
  if (!message.attachmentUrl.endsWith(`/${encodeURIComponent(filename)}`)) {
    throw new NotFoundError("Attachment not found");
  }

  return resolve(attachmentKey(familyId, messageId, filename), "application/octet-stream");
}
