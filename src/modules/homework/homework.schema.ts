import { z } from "zod";

// Zod boundary contract for parent-authored homework creation (Principle III).
// status is intentionally NOT accepted — it is server-authoritative (FR-017).

export const homeworkChildIdParamSchema = z.object({
  childId: z.string().min(1),
});

export const createHomeworkSchema = {
  params: homeworkChildIdParamSchema,
  body: z.object({
    subject: z.string().min(1).max(100),
    topic: z.string().min(1).max(200),
    // Accept a calendar date (YYYY-MM-DD, from a <input type="date">) or a full ISO datetime.
    deadline: z
      .string()
      .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: "Invalid deadline date" }),
  }),
};

export type CreateHomeworkBody = z.infer<typeof createHomeworkSchema.body>;
