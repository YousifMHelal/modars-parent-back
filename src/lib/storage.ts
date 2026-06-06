// Object-storage abstraction (research.md §6).
//
// Dev/local-filesystem stub: `put` writes bytes under STORAGE_DIR keyed by a
// path-like key and returns a public URL built from STORAGE_PUBLIC_URL; `get`
// reads them back. A Phase 7 R2/S3 adapter will satisfy the same interface, so
// callers depend only on these two functions, never on the filesystem.

import fs from "node:fs/promises";
import path from "node:path";
import config from "../config/index.js";

export interface ObjectStorage {
  put(key: string, bytes: Buffer, contentType: string): Promise<string>;
  get(key: string): Promise<Buffer>;
}

function safeKey(key: string): string {
  // Disallow traversal; keep a flat, predictable layout under STORAGE_DIR.
  return key.replace(/\.\.+/g, "").replace(/^\/+/, "");
}

function publicUrlFor(key: string): string {
  const base = config.STORAGE_PUBLIC_URL.replace(/\/+$/, "");
  return `${base}/${safeKey(key)}`;
}

export async function put(key: string, bytes: Buffer, _contentType: string): Promise<string> {
  const cleaned = safeKey(key);
  const filePath = path.join(config.STORAGE_DIR, cleaned);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
  return publicUrlFor(cleaned);
}

export async function get(key: string): Promise<Buffer> {
  const filePath = path.join(config.STORAGE_DIR, safeKey(key));
  return fs.readFile(filePath);
}

const storage: ObjectStorage = { put, get };
export default storage;
