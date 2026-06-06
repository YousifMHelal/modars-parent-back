import { z } from "zod";

// ── US1: Parent auth ──────────────────────────────────────────────────────────

export const registerParentSchema = {
  body: z.object({
    familyName: z.string().min(1).max(100),
    fullName: z.string().min(1).max(200),
    email: z.string().email(),
    password: z.string().min(8).max(128),
    dob: z.string().date(),
    country: z.string().min(2).max(10).optional(),
  }),
};

export const loginParentSchema = {
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
    deviceLabel: z.string().max(200).optional(),
  }),
};

export const refreshSchema = {
  body: z.object({
    refreshToken: z.string().min(1),
  }),
};

export const verifyEmailSchema = {
  query: z.object({
    token: z.string().min(1),
  }),
};

// ── US2: Child auth ───────────────────────────────────────────────────────────

export const childLoginSchema = {
  body: z
    .union([
      z.object({
        username: z.string().min(1),
        password: z.string().min(1),
        deviceLabel: z.string().max(200).optional(),
      }),
      z.object({
        username: z.string().min(1),
        pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
        deviceLabel: z.string().max(200).optional(),
      }),
    ])
    .refine((data) => ("password" in data && data.password) || ("pin" in data && data.pin), {
      message: "Either password or PIN is required",
    }),
};

// ── US4: Update child credentials ─────────────────────────────────────────────

export const updateChildCredentialsSchema = {
  params: z.object({
    childId: z.string().min(1),
  }),
  body: z
    .object({
      username: z.string().min(4).max(20).optional(),
      password: z.string().min(6).max(128).optional(),
      pin: z
        .string()
        .regex(/^\d{4}$/, "PIN must be exactly 4 digits")
        .optional(),
    })
    .refine(
      (data) =>
        data.username !== undefined || data.password !== undefined || data.pin !== undefined,
      { message: "At least one of username, password, or pin is required" },
    ),
};

// ── US5: Shared device ────────────────────────────────────────────────────────

export const reauthSchema = {
  body: z.object({
    deviceId: z.string().min(1),
    password: z.string().min(1),
  }),
};

// ── US6: OAuth ────────────────────────────────────────────────────────────────

export const oauthProviderSchema = {
  params: z.object({
    provider: z.enum(["google", "apple"]),
  }),
};

export const completeDobSchema = {
  body: z.object({
    dobToken: z.string().min(1),
    dob: z.string().date(),
  }),
};
