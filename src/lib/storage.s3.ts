// S3-compatible storage backend — serves both AWS S3 and Cloudflare R2 (research.md §6).
// Objects land in a PRIVATE bucket (no public ACL); retrieval is via a short-lived
// pre-signed URL (research.md §7). The `put`/`get` contract matches the local stub so
// existing callers are unchanged; `signRead` is the additive retrieval capability the
// family-scoped /files route uses for the S3 backend.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import pino from "pino";
import config from "../config/index.js";
import { safeKey } from "./storage.local.js";
import type { ObjectStorage } from "./storage.js";

const logger = pino({ name: "storage.s3" });

let cachedClient: S3Client | null = null;

function client(): S3Client {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: config.STORAGE_S3_REGION,
    // R2 (and other S3-compatibles) need a custom endpoint; AWS uses the region default.
    ...(config.STORAGE_S3_ENDPOINT ? { endpoint: config.STORAGE_S3_ENDPOINT } : {}),
    // Path-style addressing works across R2/MinIO/S3 with custom endpoints.
    ...(config.STORAGE_S3_ENDPOINT ? { forcePathStyle: true } : {}),
    credentials: {
      accessKeyId: config.STORAGE_S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: config.STORAGE_S3_SECRET_ACCESS_KEY ?? "",
    },
  });
  return cachedClient;
}

function bucket(): string {
  // Config's superRefine guarantees this is set when STORAGE_BACKEND=s3.
  return config.STORAGE_S3_BUCKET ?? "";
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  // The AWS SDK body is a Node Readable in this runtime.
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function put(key: string, bytes: Buffer, contentType: string): Promise<string> {
  const cleaned = safeKey(key);
  try {
    await client().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: cleaned,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  } catch (err) {
    logger.error({ err, key: cleaned }, "S3 put failed");
    throw err;
  }
  // Return the family-namespaced key as the stable stored reference. The DB stores an
  // app `/files/...` ref (built by callers); the raw key is never a public URL.
  return cleaned;
}

async function get(key: string): Promise<Buffer> {
  const cleaned = safeKey(key);
  try {
    const res = await client().send(
      new GetObjectCommand({ Bucket: bucket(), Key: cleaned }),
    );
    return await streamToBuffer(res.Body);
  } catch (err) {
    logger.error({ err, key: cleaned }, "S3 get failed");
    throw err;
  }
}

/** A short-lived pre-signed GET URL for the object (research.md §7). */
async function signRead(key: string, ttlSeconds = config.STORAGE_S3_SIGNED_URL_TTL): Promise<string> {
  const cleaned = safeKey(key);
  try {
    return await getSignedUrl(
      client(),
      new GetObjectCommand({ Bucket: bucket(), Key: cleaned }),
      { expiresIn: ttlSeconds },
    );
  } catch (err) {
    logger.error({ err, key: cleaned }, "S3 signRead failed");
    throw err;
  }
}

export const s3Storage: ObjectStorage = { put, get, signRead };
export default s3Storage;
