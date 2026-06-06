// Family-namespaced storage keys + the stored-reference convention (research.md §7,
// data-model.md). Object keys are namespaced by family so they are non-enumerable across
// families and authorization can be derived from the key's owning record. The DB stores a
// stable app `/files/...` reference (NOT a raw public bucket URL), resolved by the /files
// route which signs (S3) or streams (local) the bytes after a family-scope check.

/** Private-bucket key for a child's login card: `<familyId>/login-cards/<childId>.png`. */
export function loginCardKey(familyId: string, childId: string): string {
  return `${familyId}/login-cards/${childId}.png`;
}

/** Private-bucket key for a message attachment. */
export function attachmentKey(familyId: string, messageId: string, filename: string): string {
  return `${familyId}/attachments/${messageId}/${filename}`;
}

/** Stable app reference persisted in `Child.loginCardUrl` (an app route, not a bucket URL). */
export function loginCardRef(childId: string): string {
  return `/files/login-cards/${childId}`;
}

/** Stable app reference persisted in `Message.attachmentUrl`. */
export function attachmentRef(messageId: string, filename: string): string {
  return `/files/attachments/${messageId}/${encodeURIComponent(filename)}`;
}

/** Private-bucket key for a data export bundle: `<familyId>/exports/<exportId>.json.gz`. */
export function exportKey(familyId: string, exportId: string): string {
  return `${familyId}/exports/${exportId}.json.gz`;
}

/** Stable app reference for a READY export, resolved through the family-scoped /files route. */
export function exportRef(exportId: string): string {
  return `/files/exports/${exportId}`;
}
