import { z } from "zod";

// Zod boundary contracts for the settings write module (Principle III).
// Mirrors contracts/settings.openapi.yaml + the FE Settings screen.

// ── US3: account + notification prefs ─────────────────────────────────────────

export const accountUpdateSchema = {
  body: z
    .object({
      fullName: z.string().min(1).max(200).optional(),
      phoneCountry: z.string().max(10).optional(),
      phoneNumber: z.string().max(40).optional(),
      country: z.string().min(2).max(100).optional(),
    })
    .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" }),
};

export type AccountUpdateInput = z.infer<typeof accountUpdateSchema.body>;

export const notificationPrefsSchema = {
  body: z
    .object({
      push: z.boolean().optional(),
      email: z.boolean().optional(),
      whatsapp: z.boolean().optional(),
    })
    .refine((d) => Object.keys(d).length > 0, { message: "At least one preference is required" }),
};

export type NotificationPrefsInput = z.infer<typeof notificationPrefsSchema.body>;

// ── US4: co-parent invite / accept / revoke ───────────────────────────────────

export const inviteSchema = {
  body: z.object({
    email: z.string().email(),
  }),
};

export type InviteInput = z.infer<typeof inviteSchema.body>;

export const acceptSchema = {
  body: z.object({
    token: z.string().min(1),
    fullName: z.string().min(1).max(200),
    password: z.string().min(6).max(128),
    dateOfBirth: z.string().date(),
  }),
};

export type AcceptInput = z.infer<typeof acceptSchema.body>;

export const invitationIdParamSchema = z.object({
  id: z.string().min(1),
});

export const revokeSchema = {
  params: invitationIdParamSchema,
};
