import { z } from "zod";

// The LOCKED AI-tutor session-event contract (contracts/session-event.schema.md,
// FR-019, Principle III). Validated at ingestion; an event failing validation is
// rejected and changes nothing. The shape is fixed so the AI pipeline has a stable
// target — extend additively only.

export const sessionEventSchema = z
  .object({
    eventId: z.string().min(1),
    familyId: z.string().min(1),
    childId: z.string().min(1),
    subject: z.string().min(1),
    topics: z.array(z.string().min(1)).min(1),
    masteryByTopic: z.record(z.string(), z.number().int().min(0).max(100)),
    durationMinutes: z.number().int().min(0),
    xpEarned: z.number().int().min(0),
    outcome: z.enum(["started", "completed", "abandoned"]),
    homeworkRef: z.string().min(1).optional(),
    occurredAt: z.string().datetime(),
  })
  .strict()
  // Mastery keys must be a subset of the touched topics.
  .refine(
    (e) => Object.keys(e.masteryByTopic).every((k) => e.topics.includes(k)),
    { message: "masteryByTopic keys must be a subset of topics", path: ["masteryByTopic"] },
  );

export type SessionEvent = z.infer<typeof sessionEventSchema>;
