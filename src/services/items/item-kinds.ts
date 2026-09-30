// Link, tool, and article share identical fields with no special-casing
// between them — article (ticket 02) is a "saved to read" kind, shaped
// exactly like a link. `page` (the wiki kind, originally stored as
// `"article"` before ticket 02's rename) reuses the same table and
// permission model but has its own authoring path: a markdown body in
// `content`, no URL, and no metadata fetch.
export type CreatableItemKind = "link" | "tool" | "article" | "page";

export const CREATABLE_ITEM_KINDS: readonly CreatableItemKind[] = ["link", "tool", "article", "page"];

export function isCreatableItemKind(value: unknown): value is CreatableItemKind {
  return CREATABLE_ITEM_KINDS.includes(value as CreatableItemKind);
}

// The three kinds the Import/Export modal offers (ticket 07) — wiki pages
// are never a content type there.
export type ImportableItemKind = Exclude<CreatableItemKind, "page">;

export function isImportableItemKind(value: unknown): value is ImportableItemKind {
  return value !== "page" && isCreatableItemKind(value);
}

/**
 * Kinds shown in the shared library list/search (`/`, `GET /api/items`) and
 * offered by ItemForm's create-mode kind picker there — wiki pages get their
 * own dedicated `/wiki` home and are never a content type in either place.
 * Same set as ImportableItemKind, aliased under its own name since the two
 * exclusions exist for unrelated reasons and could diverge later.
 */
export type LibraryItemKind = ImportableItemKind;

export const LIBRARY_ITEM_KINDS: LibraryItemKind[] = CREATABLE_ITEM_KINDS.filter(
  (kind): kind is LibraryItemKind => kind !== "page",
);

export const isLibraryItemKind = isImportableItemKind;
