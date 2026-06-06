import config from "../../config/index.js";
import type { PaymentProvider } from "./provider.js";
import { createFakeProvider, FAKE_WEBHOOK_SECRET } from "./fake.js";
import { createMoyasarProvider } from "./moyasar.js";

// Payment-provider resolver (research.md §1). Every module depends only on the
// PaymentProvider interface; this is the single place the concrete adapter is chosen:
//
//   - In test, OR when PAYMENT_PROVIDER=fake, OR in dev without the provider secret
//     key → the deterministic in-memory fake (offline, no network).
//   - Otherwise → the Moyasar REST adapter using the configured secrets.
//
// The instance is memoized so the whole process shares one provider.

let instance: PaymentProvider | undefined;

function shouldUseFake(): boolean {
  if (config.NODE_ENV === "test") return true;
  if (config.PAYMENT_PROVIDER === "fake") return true;
  // Dev convenience: no secret key configured → fake, so the flow runs offline.
  if (config.NODE_ENV === "development" && !config.PAYMENT_PROVIDER_SECRET_KEY) return true;
  return false;
}

export function getPaymentProvider(): PaymentProvider {
  if (instance) return instance;

  if (shouldUseFake()) {
    instance = createFakeProvider(config.PAYMENT_WEBHOOK_SECRET ?? FAKE_WEBHOOK_SECRET);
  } else {
    instance = createMoyasarProvider({
      secretKey: config.PAYMENT_PROVIDER_SECRET_KEY ?? "",
      webhookSecret: config.PAYMENT_WEBHOOK_SECRET ?? "",
    });
  }
  return instance;
}

/** Test-only: reset the memoized provider (e.g. between suites). */
export function __resetPaymentProvider(): void {
  instance = undefined;
}

export type { PaymentProvider } from "./provider.js";
