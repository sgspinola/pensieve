import type { ImportableItemKind } from "@/services/items/items";

/**
 * The single source of truth for "which content kinds does Import/Export
 * offer, in what order, under what label" — shared by `ImportExportModal`'s
 * type picker and `SampleSnippet`'s tab strip so the two can't drift out of
 * sync (e.g. a kind added to one list but not the other).
 */
export type ContentKind = "flashcards" | ImportableItemKind;

export const CONTENT_KINDS: readonly { value: ContentKind; label: string }[] = [
  { value: "flashcards", label: "Flashcards" },
  { value: "link", label: "Links" },
  { value: "tool", label: "Tools" },
  { value: "article", label: "Articles" },
];
