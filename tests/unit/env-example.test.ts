import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../");

const REQUIRED_KEYS = [
  "NODE_ENV",
  "PORT",
  "DATABASE_URL",
  "REDIS_URL",
  "CORS_ORIGINS",
  "RATE_LIMIT_WINDOW_MS",
  "RATE_LIMIT_MAX",
  "LOG_LEVEL",
];

describe(".env.example completeness", () => {
  it("exists at the backend root", () => {
    const envExamplePath = path.join(rootDir, ".env.example");
    expect(fs.existsSync(envExamplePath)).toBe(true);
  });

  it("contains an entry for every required config key", () => {
    const envExamplePath = path.join(rootDir, ".env.example");
    const content = fs.readFileSync(envExamplePath, "utf-8");

    const missing = REQUIRED_KEYS.filter((key) => !content.includes(key));
    expect(missing, `Missing keys in .env.example: ${missing.join(", ")}`).toEqual([]);
  });
});
