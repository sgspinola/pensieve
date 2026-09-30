import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/current-user";
import { LIBRARY_ITEM_KINDS, countItems, isLibraryItemKind, listItems } from "@/services/items/items";
import { ITEMS_PAGE_SIZE } from "@/services/items/pagination";
import { listLibraryTags } from "@/services/tags/tags";
import { dropStaleTags, parseTagsParam } from "./items/chip-filters";
import { Header } from "./Header";
import { ItemsLibrary } from "./items/ItemsLibrary";
import { serializeItem } from "./items/types";
import { Wordmark } from "./Wordmark";
import styles from "./page-shell.module.css";

/**
 * The search box, kind chips, and tag chips (tickets 04/08) all live in the
 * URL (`?query=&kind=&tags=`) rather than component state, so the actual
 * filtering happens here via `listItems`, the same service function/query
 * path used for the unfiltered list — not a parallel search implementation.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; kind?: string | string[]; tags?: string | string[] }>;
}) {
  const user = await requireCurrentUser();

  const { query, kind: kindParam, tags: tagsParam } = await searchParams;
  // Reuse parseTagsParam's string|string[]|undefined normalization for kind
  // params too (ticket 10: kind chips became repeatable like tag chips), then
  // filter through isLibraryItemKind — wiki pages are never a content type
  // in this flat view, so an explicit `?kind=page` is stripped the same way
  // an invalid value would be, not honored. Only genuinely-absent `kind`
  // (nothing at all in the URL) gets the landing default below — an
  // explicit-but-invalid value (e.g. `?kind=bogus`) is left as "no kinds
  // selected" rather than silently reapplying the default, matching how
  // other filters here treat present-but-invalid input as "no match".
  const kinds = parseTagsParam(kindParam).filter(isLibraryItemKind);
  const kindParamAbsent = kindParam === undefined;
  const effectiveKinds = kindParamAbsent ? LIBRARY_ITEM_KINDS : kinds;
  const requestedTags = parseTagsParam(tagsParam);

  const db = getDb();
  const tagSuggestions = await listLibraryTags(db);
  // Self-healing against a pruned selected tag — see FlashcardsPage's
  // matching comment (same `pruneUnusedTags`-driven staleness, same fix).
  const tags = dropStaleTags(requestedTags, tagSuggestions);
  const hasStaleTags = tags.length !== requestedTags.length;
  const filters = { query, kinds: effectiveKinds.length > 0 ? effectiveKinds : undefined, tags };
  // Ticket 02: only the first ITEMS_PAGE_SIZE items are fetched server-side
  // (keeping first paint synchronous/flash-free, same as FlashcardsPage);
  // the rest of the filtered result set is handed off to ItemsLibrary's
  // client-side infinite scroll. `totalCount` is a real COUNT(*) over the
  // same filters, not `items.length` — it stays correct as more pages load.
  const [firstPage, totalCount] = await Promise.all([
    listItems(db, { ...filters, limit: ITEMS_PAGE_SIZE }),
    countItems(db, filters),
  ]);
  const items = firstPage.items.map(serializeItem);

  return (
    <main className={`${styles.shell} ${styles.wide}`}>
      <h1>
        <Wordmark />
      </h1>
      <Header user={user} />
      <ItemsLibrary
        items={items}
        nextCursor={firstPage.nextCursor}
        totalCount={totalCount}
        currentUser={user}
        tagSuggestions={tagSuggestions}
        searchQuery={query ?? ""}
        kindFilter={effectiveKinds}
        hasExplicitKindFilter={!kindParamAbsent}
        tagsFilter={tags}
        hasStaleTags={hasStaleTags}
      />
    </main>
  );
}
