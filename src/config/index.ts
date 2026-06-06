import { config as loadDotenv } from "dotenv";
import { z } from "zod";

if (process.env["NODE_ENV"] !== "production") {
  loadDotenv();
}

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url().startsWith("postgres"),
  REDIS_URL: z.string().url(),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((val) =>
      val
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // Auth — JWT
  JWT_ACCESS_SECRET: z.string().min(32).default("change-me-access-secret-at-least-32-chars!!"),
  JWT_REFRESH_SECRET: z.string().min(32).default("change-me-refresh-secret-at-least-32-chars!"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),

  // Auth — Lockout
  AUTH_LOCK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  AUTH_LOCK_WINDOW: z.string().default("15m"),

  // Auth — Re-auth (shared device)
  REAUTH_WINDOW: z.string().default("15m"),
  // When Redis is unavailable, whether the shared-device re-auth gate lets requests
  // through (true) or rejects them (false). Defaults to fail-closed.
  REAUTH_FAIL_OPEN: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // Mailer
  MAILER_TRANSPORT: z.enum(["stub", "smtp"]).default("stub"),
  MAILER_FROM: z.string().email().default("noreply@example.com"),
  MAILER_SMTP_HOST: z.string().optional(),
  MAILER_SMTP_PORT: z.coerce.number().int().optional(),
  MAILER_SMTP_USER: z.string().optional(),
  MAILER_SMTP_PASS: z.string().optional(),

  // OAuth — Google
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),

  // OAuth — Apple
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  APPLE_CALLBACK_URL: z.string().url().optional(),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid configuration:\n${issues}`);
}

// In production, refuse to boot with the known-weak development secret defaults.
if (parsed.data.NODE_ENV === "production") {
  const secrets: Array<[string, string]> = [
    ["JWT_ACCESS_SECRET", parsed.data.JWT_ACCESS_SECRET],
    ["JWT_REFRESH_SECRET", parsed.data.JWT_REFRESH_SECRET],
  ];
  const weak = secrets.filter(([, value]) => value.startsWith("change-me-"));
  if (weak.length) {
    throw new Error(
      `Refusing to start in production with default secrets: ${weak
        .map(([name]) => name)
        .join(", ")}`,
    );
  }
}

const config = Object.freeze(parsed.data);

export default config;
export type Config = typeof config;
