import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// ── Capture S3 SDK calls so we can assert the adapter builds correct private keys
//    and signs reads without any live cloud (research.md §6/§7). ──
const sendMock = vi.fn();
const putCtorArgs: Array<Record<string, unknown>> = [];
const getCtorArgs: Array<Record<string, unknown>> = [];
const signArgs: Array<{ command: unknown; opts: unknown }> = [];

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    send = sendMock;
  }
  class PutObjectCommand {
    constructor(public input: Record<string, unknown>) {
      putCtorArgs.push(input);
    }
  }
  class GetObjectCommand {
    constructor(public input: Record<string, unknown>) {
      getCtorArgs.push(input);
    }
  }
  return { S3Client, PutObjectCommand, GetObjectCommand };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn((_client: unknown, command: unknown, opts: unknown) => {
    signArgs.push({ command, opts });
    return Promise.resolve("https://signed.example/object?sig=abc");
  }),
}));

describe("storage selector + backends", () => {
  beforeEach(() => {
    sendMock.mockReset();
    putCtorArgs.length = 0;
    getCtorArgs.length = 0;
    signArgs.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("selects the local backend by default (test env)", async () => {
    const { default: storage, canSignRead } = await import("../../src/lib/storage.js");
    // Local backend has localStream, no signRead.
    expect(typeof storage.localStream).toBe("function");
    expect(canSignRead()).toBe(false);
  });

  it("local backend round-trips put then get", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-test-"));
    vi.stubEnv("STORAGE_DIR", dir);
    // config is frozen at import; the local backend reads config.STORAGE_DIR at call time,
    // so stub before importing a fresh copy.
    vi.resetModules();
    const { default: local } = await import("../../src/lib/storage.local.js");
    const key = "fam_1/login-cards/child_1.png";
    const bytes = Buffer.from("hello-bytes");
    const ref = await local.put(key, bytes, "image/png");
    expect(ref).toContain("fam_1/login-cards/child_1.png");
    const read = await local.get(key);
    expect(read.equals(bytes)).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("local backend safeKey rejects traversal", async () => {
    const { safeKey } = await import("../../src/lib/storage.local.js");
    expect(safeKey("../../etc/passwd")).not.toContain("..");
    expect(safeKey("/leading/slash")).toBe("leading/slash");
  });

  it("s3 backend puts to the private bucket under the family-namespaced key", async () => {
    vi.stubEnv("STORAGE_BACKEND", "s3");
    vi.stubEnv("STORAGE_S3_BUCKET", "modrs-objects");
    vi.stubEnv("STORAGE_S3_ACCESS_KEY_ID", "key");
    vi.stubEnv("STORAGE_S3_SECRET_ACCESS_KEY", "secret");
    vi.resetModules();
    sendMock.mockResolvedValue({});
    const { default: s3 } = await import("../../src/lib/storage.s3.js");

    const key = "fam_1/login-cards/child_1.png";
    const ref = await s3.put(key, Buffer.from("png"), "image/png");
    // The stored ref is the raw family-namespaced key, never a public URL.
    expect(ref).toBe(key);
    expect(putCtorArgs[0]).toMatchObject({
      Bucket: "modrs-objects",
      Key: key,
      ContentType: "image/png",
    });
  });

  it("s3 backend signs a short-lived read URL", async () => {
    vi.stubEnv("STORAGE_BACKEND", "s3");
    vi.stubEnv("STORAGE_S3_BUCKET", "modrs-objects");
    vi.stubEnv("STORAGE_S3_ACCESS_KEY_ID", "key");
    vi.stubEnv("STORAGE_S3_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("STORAGE_S3_SIGNED_URL_TTL", "120");
    vi.resetModules();
    const { default: s3 } = await import("../../src/lib/storage.s3.js");

    const url = await s3.signRead!("fam_1/login-cards/child_1.png");
    expect(url).toBe("https://signed.example/object?sig=abc");
    expect(getCtorArgs.at(-1)).toMatchObject({
      Bucket: "modrs-objects",
      Key: "fam_1/login-cards/child_1.png",
    });
    expect(signArgs.at(-1)!.opts).toMatchObject({ expiresIn: 120 });
  });

  it("s3 backend surfaces a backend-unreachable error from put", async () => {
    vi.stubEnv("STORAGE_BACKEND", "s3");
    vi.stubEnv("STORAGE_S3_BUCKET", "modrs-objects");
    vi.stubEnv("STORAGE_S3_ACCESS_KEY_ID", "key");
    vi.stubEnv("STORAGE_S3_SECRET_ACCESS_KEY", "secret");
    vi.resetModules();
    sendMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const { default: s3 } = await import("../../src/lib/storage.s3.js");

    await expect(s3.put("fam_1/x.png", Buffer.from("x"), "image/png")).rejects.toThrow(
      /ECONNREFUSED/,
    );
  });
});
