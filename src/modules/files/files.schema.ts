import { z } from "zod";
import { ValidationError } from "../../lib/errors.js";

// Attachment boundary validation (FR-014, research §9): reject disallowed content types or
// oversized payloads at the boundary, BEFORE any storage.put — never write then delete. Used
// by whatever path stores a message attachment.

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB

export const ALLOWED_ATTACHMENT_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
]);

export const attachmentMetadataSchema = z.object({
  filename: z
    .string()
    .min(1)
    .max(255)
    // No path separators or traversal in the filename component of the key.
    .regex(/^[^/\\]+$/, "filename must not contain path separators"),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

export type AttachmentMetadata = z.infer<typeof attachmentMetadataSchema>;

/**
 * Validate an attachment's metadata against the allowlist + size cap. Throws
 * ValidationError (400) on a disallowed type or oversized payload so the caller never
 * reaches storage.put for a rejected attachment.
 */
export function assertAttachmentAllowed(meta: AttachmentMetadata): void {
  const parsed = attachmentMetadataSchema.parse(meta);
  if (!ALLOWED_ATTACHMENT_TYPES.has(parsed.contentType)) {
    throw new ValidationError(`Attachment type not allowed: ${parsed.contentType}`);
  }
  if (parsed.sizeBytes > ATTACHMENT_MAX_BYTES) {
    throw new ValidationError(
      `Attachment exceeds the maximum size of ${ATTACHMENT_MAX_BYTES} bytes`,
    );
  }
}
