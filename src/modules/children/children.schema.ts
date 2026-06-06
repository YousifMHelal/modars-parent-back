import { z } from "zod";

// Zod boundary contracts for the children write module (Principle III).
// Mirrors contracts/children.openapi.yaml and the FE AddChildStep payload.

const usernameField = z
  .string()
  .min(4)
  .max(20)
  .regex(/^[a-zA-Z0-9_]+$/, "Username may only contain letters, numbers, and underscore");

const passwordField = z.string().min(6).max(128);
const pinField = z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits");

const curriculumEnum = z.enum(["BRITISH", "AMERICAN", "IB", "SAUDI_NATIONAL"]);
const genderEnum = z.enum(["MALE", "FEMALE"]);

export const childIdParamSchema = z.object({
  childId: z.string().min(1),
});

// ── Create ────────────────────────────────────────────────────────────────────
// Exactly-at-least-one of { password, pin } is required.

export const createChildSchema = {
  body: z
    .object({
      displayName: z.string().min(1).max(100),
      dateOfBirth: z.string().date(),
      gender: genderEnum,
      country: z.string().min(1).max(100),
      grade: z.string().min(1).max(100),
      curriculum: curriculumEnum,
      subjects: z.array(z.string().min(1)).min(1),
      username: usernameField,
      password: passwordField.optional(),
      pin: pinField.optional(),
    })
    .refine((d) => d.password !== undefined || d.pin !== undefined, {
      message: "Either password or PIN is required",
    }),
};

export type CreateChildInput = z.infer<typeof createChildSchema.body>;

// ── Edit (profile / parental controls) ────────────────────────────────────────

export const editChildSchema = {
  params: childIdParamSchema,
  body: z
    .object({
      grade: z.string().min(1).max(100).optional(),
      curriculum: curriculumEnum.optional(),
      subjects: z.array(z.string().min(1)).optional(),
      bedtimeCutoff: z.string().nullable().optional(),
      allowedDays: z.array(z.string()).optional(),
      blockedSubjects: z.array(z.string()).optional(),
    })
    .refine((d) => Object.keys(d).length > 0, {
      message: "At least one field is required",
    }),
};

export type EditChildInput = z.infer<typeof editChildSchema.body>;

// ── Credentials ───────────────────────────────────────────────────────────────

export const credentialsSchema = {
  params: childIdParamSchema,
  body: z
    .object({
      username: usernameField.optional(),
      password: passwordField.optional(),
      pin: pinField.optional(),
    })
    .refine(
      (d) => d.username !== undefined || d.password !== undefined || d.pin !== undefined,
      { message: "At least one of username, password, or pin is required" },
    ),
};

export type CredentialsInput = z.infer<typeof credentialsSchema.body>;

// ── Username availability check ───────────────────────────────────────────────

export const usernameCheckSchema = {
  query: z.object({
    username: z.string().min(1),
  }),
};

// ── Pause / reactivate / restore (param-only) ─────────────────────────────────

export const childActionSchema = {
  params: childIdParamSchema,
};
