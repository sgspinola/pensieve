import { z } from "zod";

/**
 * A required, non-blank-after-trim string field — same shape as
 * import-schemas.ts's `fileField` (ticket 20): `.refine` rather than
 * `.trim().min(1, ...)` so the parsed value is returned exactly as the
 * caller sent it (including any surrounding whitespace) — createFlashcard
 * already trims `front` only for its hash (see flashcards.ts), and this
 * schema shouldn't silently change what's stored beyond that.
 */
function requiredText(fieldName: string) {
  return z.string().refine((value) => value.trim().length > 0, {
    message: `${fieldName} is required`,
  });
}

/**
 * POST /api/flashcards's create body (ticket 18), replacing the hand-rolled
 * front/back/source/tags checks that used to live in route.ts. `tags` is
 * validated for shape only (an array of strings, or omitted) — whether at
 * least one non-blank tag was actually given is a business rule, not a
 * shape rule, and stays enforced by createFlashcard's
 * hasTags/TAGS_REQUIRED_ERROR check (src/services/tags/validation.ts),
 * which also has to run for PATCH's tags-replace case below, so it isn't
 * duplicated here.
 */
export const createFlashcardBodySchema = z.object({
  front: requiredText("front"),
  back: requiredText("back"),
  source: requiredText("source"),
  tags: z.array(z.string()).optional(),
});

export type CreateFlashcardBody = z.infer<typeof createFlashcardBodySchema>;

/**
 * PATCH /api/flashcards/[id]'s update body (ticket 18), replacing the
 * hand-rolled front/back/source/tags type checks that used to live in
 * route.ts. Same fields as create, all optional — an omitted field means
 * "leave unchanged" (see UpdateFlashcardInput), so this schema only checks
 * type when a field is present, the same as the checks it replaces (it
 * doesn't reject a blank string the way create's `requiredText` does —
 * matching the existing field semantics, not tightening them).
 */
export const updateFlashcardBodySchema = z.object({
  front: z.string().optional(),
  back: z.string().optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type UpdateFlashcardBody = z.infer<typeof updateFlashcardBodySchema>;
