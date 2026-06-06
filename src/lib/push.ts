import pino from "pino";
import config from "../config/index.js";

const logger = pino({ name: "push" });

// ── Push channel adapter (research.md §7) ─────────────────────────────────────
//
// Mirrors the mailer/payments stub-adapter pattern: a small provider interface with a
// dev STUB that only logs, selected by PUSH_PROVIDER. The FCM transport is a wired
// placeholder (real SDK swap is an ops task); the stub keeps dev/test offline and
// deterministic. A push send needs the recipient's registered device tokens, which the
// notifications service supplies from the PushToken store.

export type PushPlatform = "FCM" | "APNS";

export interface PushTarget {
  token: string;
  platform: PushPlatform;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Optional structured data payload for the client. */
  data?: Record<string, string>;
}

export interface PushSendResult {
  delivered: number;
  /** Tokens the provider reported invalid; the caller should disable them. */
  invalidTokens: string[];
}

export interface PushProvider {
  send(targets: PushTarget[], message: PushMessage): Promise<PushSendResult>;
}

const stubProvider: PushProvider = {
  send(targets, message) {
    logger.info(
      { tokenCount: targets.length, title: message.title },
      "[stub push] Would deliver push — body logged below",
    );
    logger.debug({ body: message.body, data: message.data }, "[stub push] push body");
    return Promise.resolve({ delivered: targets.length, invalidTokens: [] });
  },
};

// Placeholder FCM provider: until the real SDK is wired it behaves like the stub but
// logs under the fcm name so prod misconfig is visible. The config guard already
// refuses to boot in production with PUSH_PROVIDER=fcm but no credentials.
const fcmProvider: PushProvider = {
  send(targets, message) {
    logger.warn(
      { tokenCount: targets.length, title: message.title, projectId: config.FCM_PROJECT_ID },
      "[fcm push] FCM transport not yet wired — logging only",
    );
    return Promise.resolve({ delivered: targets.length, invalidTokens: [] });
  },
};

let provider: PushProvider | null = null;

/** The configured push provider (stub in dev/test; fcm placeholder otherwise). */
export function getPushProvider(): PushProvider {
  if (provider) return provider;
  provider = config.PUSH_PROVIDER === "fcm" ? fcmProvider : stubProvider;
  return provider;
}

export default { getPushProvider };
