// Object-storage abstraction (research.md §6/§7).
//
// The `put`/`get` contract is UNCHANGED so existing callers (login-card backfill,
// attachments) need no changes. The backend is selected by `config.STORAGE_BACKEND`
// (local | s3), mirroring the mailer (stub|smtp) and payments (moyasar|fake) resolvers.
//
// Two additive, optional retrieval capabilities support the family-scoped /files route:
//   - `signRead(key, ttl)` — a short-lived pre-signed URL (S3/R2 backend).
//   - `localStream(key)`   — a readable stream of the bytes (local dev backend).
// Callers pass family-namespaced keys; this module does not namespace keys itself.

import type { ReadStream } from "node:fs";
import config from "../config/index.js";
import localBackend from "./storage.local.js";
import s3Backend from "./storage.s3.js";

export interface ObjectStorage {
  put(key: string, bytes: Buffer, contentType: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  /** S3/R2: a short-lived pre-signed GET URL. Absent on the local backend. */
  signRead?(key: string, ttlSeconds?: number): Promise<string>;
  /** Local: a readable stream of the bytes. Absent on the S3 backend. */
  localStream?(key: string): ReadStream;
}

// Single place the concrete backend is chosen (Principle II). Memoized so the whole
// process shares one adapter; both are imported but only the selected one is used.
const storage: ObjectStorage = config.STORAGE_BACKEND === "s3" ? s3Backend : localBackend;

export async function put(key: string, bytes: Buffer, contentType: string): Promise<string> {
  return storage.put(key, bytes, contentType);
}

export async function get(key: string): Promise<Buffer> {
  return storage.get(key);
}

/** True when the active backend serves reads via signed URLs (S3/R2). */
export function canSignRead(): boolean {
  return typeof storage.signRead === "function";
}

export default storage;
