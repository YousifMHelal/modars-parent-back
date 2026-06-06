import { z } from "zod";

// Zod boundary contract for push-token registration (Principle III; mirrors
// contracts/push-registration.openapi.yaml). Only platform + token are accepted; the
// family/owner are taken from the verified session, never the body (Principle I). The
// body is STRICT so unexpected fields are rejected rather than silently stripped.

export const registerPushTokenSchema = {
  body: z
    .object({
      platform: z.enum(["FCM", "APNS"]),
      token: z.string().min(1),
    })
    .strict(),
};

export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema.body>;

export const deregisterPushTokenSchema = {
  query: z.object({
    token: z.string().min(1),
  }),
};
