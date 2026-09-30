/**
 * Derives a readable title from a URL when no real title is available (e.g.
 * a failed metadata fetch) — strips the last path segment's extension,
 * de-slugifies underscores into spaces, and falls back to the hostname for a
 * trailing-slash/bare-origin URL that has no filename segment to work with.
 *
 * Originally private to the (since removed) `scripts/import-flashcards.ts` (e.g.
 * ".../Authentication_Cheat_Sheet.html" -> "Authentication Cheat Sheet");
 * extracted here so the items title-required backfill (ticket 03 of
 * batch-import-export-and-article-item-type) shares the same derivation
 * instead of reimplementing it.
 */
export function titleFromUrl(url: string): string {
  const file = url.split("/").pop() ?? url;
  const name = decodeURIComponent(file.replace(/\.html?$/, ""));
  const title = name.replace(/_/g, " ");
  return title || new URL(url).hostname;
}
