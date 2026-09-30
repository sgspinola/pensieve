import matter from "gray-matter";
import type { Database } from "@/db/client";
import { listFlashcards } from "@/services/flashcards/flashcards";

/**
 * Serializes every flashcard in the workspace (ticket 05) into the same
 * multi-entry frontmatter+body format this project already hand-authors
 * under `flashcards/` — each entry's frontmatter carries `front`/`tags`/
 * `source`, the body is `back`. `listFlashcards` with no `limit` returns
 * every row unpaginated, so this is a full export regardless of workspace
 * size. Entries are individually produced by `gray-matter`'s own
 * `stringify` (the inverse of the `matter()` parse the rest of the app
 * already uses) and simply concatenated — `stringify` always emits a
 * trailing newline before the next `---`, so no extra separator is needed
 * for the result to split back apart via `splitFrontmatterEntries`
 * (ticket 01) exactly as many entries as were written.
 */
export async function exportFlashcardsFile(db: Database): Promise<string> {
  const { flashcards } = await listFlashcards(db);

  return flashcards
    .map((card) => matter.stringify(card.back, { front: card.front, tags: card.tags, source: card.source }))
    .join("");
}
