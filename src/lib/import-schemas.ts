import { z } from "zod";
import { isImportableItemKind, type ImportableItemKind } from "@/services/items/items";

/**
 * Zod schemas for the request bodies ticket 06/07's import routes accept —
 * used with `parseOrThrow` (ticket 13) so a malformed request becomes a
 * `ValidationError` (and a clean 400) instead of each route hand-rolling its
 * own shape check. Ticket 20: replaces the removed `parseImportFileBody` /
 * `parseKindAndFileBody` / `parseItemImportBody` helpers that used to live
 * in request-fields.ts — same accepted shapes, just Zod-backed.
 */

const fileField = z.string().refine((value) => value.trim().length > 0, {
  message: "file is required",
});

/** `{ file: string }` — flashcards/import and flashcards/import/preview. */
export const importFileBodySchema = z.object({
  file: fileField,
});

export type ImportFileBody = z.infer<typeof importFileBodySchema>;

/**
 * `{ kind: string, file: string }` — items/import and items/import/preview.
 * `kind` is constrained to `ImportableItemKind` (every creatable item kind
 * except the wiki-only `"page"`) via the same `isImportableItemKind` guard
 * the removed helper delegated to, so the two can never drift.
 */
export const itemImportBodySchema = z.object({
  kind: z.custom<ImportableItemKind>(isImportableItemKind, {
    message: 'kind must be "link", "tool", or "article"',
  }),
  file: fileField,
});

export type ItemImportBody = z.infer<typeof itemImportBodySchema>;
