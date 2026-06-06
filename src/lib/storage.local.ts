// Local-filesystem storage backend (dev stub) — extracted from the original
// storage.ts (research.md §6). Preserves today's behavior: `put` writes bytes under
// STORAGE_DIR keyed by a path-like key and returns a public URL built from
// STORAGE_PUBLIC_URL; `get` reads them back. The traversal guard (`safeKey`) is kept.
//
// Phase 7: callers now pass family-namespaced keys (e.g. `<familyId>/login-cards/...`),
// which this backend writes as nested directories under STORAGE_DIR.

import fs from "node:fs/promises";
import { createReadStream, type ReadStream } from "node:fs";
import path from "node:path";
import config from "../config/index.js";
import type { ObjectStorage } from "./storage.js";

export function safeKey(key: string): string {
  // Disallow traversal; keep a predictable layout under STORAGE_DIR.
  return key.replace(/\.\.+/g, "").replace(/^\/+/, "");
}

function publicUrlFor(key: string): string {
  const base = config.STORAGE_PUBLIC_URL.replace(/\/+$/, "");
  return `${base}/${safeKey(key)}`;
}

async function put(key: string, bytes: Buffer, _contentType: string): Promise<string> {
  const cleaned = safeKey(key);
  const filePath = path.join(config.STORAGE_DIR, cleaned);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
  return publicUrlFor(cleaned);
}

async function get(key: string): Promise<Buffer> {
  const filePath = path.join(config.STORAGE_DIR, safeKey(key));
  return fs.readFile(filePath);
}

/** Open a readable stream for the object, for the /files route to pipe to the client. */
function localStream(key: string): ReadStream {
  const filePath = path.join(config.STORAGE_DIR, safeKey(key));
  return createReadStream(filePath);
}

export const localStorage: ObjectStorage = { put, get, localStream };
export default localStorage;
