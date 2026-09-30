/** The inline error shown when a flashcard is saved/imported with zero tags. */
export const TAGS_REQUIRED_ERROR = "At least one tag is required";

/**
 * True when `tags` contains at least one entry — the shared check behind
 * every "at least one tag" rule in this codebase (createFlashcard,
 * updateFlashcard, the frontmatter import, and FlashcardForm's client-side
 * validation). Deliberately has no server imports so FlashcardForm (a
 * "use client" component) can call it directly without pulling in
 * tags.ts's Node-only `@/db/client` import — same client/server split as
 * items/pagination.ts and flashcards/pagination.ts.
 */
export function hasTags(tags: string[]): boolean {
  return tags.length > 0;
}
