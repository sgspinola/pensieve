"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Inbox, Plus } from "lucide-react";
import { LIBRARY_ITEM_KINDS, type CreatableItemKind } from "@/services/items/item-kinds";
import { ITEMS_PAGE_SIZE } from "@/services/items/pagination";
import type { SessionUser } from "@/services/auth/session";
import { filterTagsByQuery } from "@/app/flashcards/study/tag-filter";
import { readErrorMessage } from "@/lib/http-client";
import { serializeTagsParam, toggleKindChip, toggleTagChip } from "./chip-filters";
import { ItemRow } from "./ItemRow";
import { kindBadgeLabel } from "./kind-badge";
import type { SerializedItem } from "./types";
import { TagCloud } from "@/app/TagCloud";
import { TagFilterInput } from "@/app/TagFilterInput";
import styles from "./ItemsLibrary.module.css";

/** How long to wait after the user stops typing before updating the URL. */
const SEARCH_DEBOUNCE_MS = 300;

interface ItemsPageResponse {
  items: SerializedItem[];
  nextCursor: string | null;
}

/**
 * Query string for GET /api/items's next page: the cursor plus the default
 * page size, and the currently-committed search/kind/tag filters (the same
 * `searchQuery`/`kindFilter`/`tagsFilter` this list was server-rendered
 * with) — so infinite scroll keeps paging through the *filtered* result set
 * instead of silently falling back to the unfiltered one. Mirrors
 * FlashcardsManager.tsx's `buildLoadMoreQuery`; exported for direct unit
 * testing, no DOM/fetch needed.
 */
export function buildLoadMoreQuery(
  cursor: string,
  searchQuery: string,
  kindFilter: CreatableItemKind[],
  tagsFilter: string[],
): string {
  const params = new URLSearchParams({ limit: String(ITEMS_PAGE_SIZE), cursor });
  if (searchQuery.trim()) params.set("query", searchQuery.trim());
  for (const kind of kindFilter) params.append("kind", kind);
  for (const tag of serializeTagsParam(tagsFilter)) params.append("tags", tag);
  return params.toString();
}

/**
 * The shared item list, the fixed-size search box, and the kind/tag filter
 * chip row (ticket 04) that replaced the old kind `<select>`. Adding an item
 * is its own page (`/items/new`, ticket 02), not rendered here.
 * search/kind/tags state lives in the URL (`?query=&kind=&tags=`), which
 * `app/page.tsx` reads and passes to `listItems` server-side, so navigating
 * there — same as `router.refresh()` after any mutation — is what refreshes
 * this with up-to-date, filtered data instead of going stale.
 *
 * Hybrid SSR + infinite scroll (ticket 02, mirroring FlashcardsManager.tsx):
 * `items`/`nextCursor` are only the server-rendered first page; local
 * `libraryItems`/`cursor` state seeds from them and grows as `loadMore`
 * fetches subsequent pages from the paginated `GET /api/items` while a
 * sentinel `<li>` near the end of the list is on-screen (see the
 * `IntersectionObserver` effect below). `totalCount` is a real
 * `COUNT(*)`-backed total for the active filter combination, rendered in the
 * heading instead of `libraryItems.length` — scrolling to load more pages
 * grows the latter without changing the former, which is exactly the point.
 *
 * Unlike `FlashcardsManager`, this component is never given a fresh `key`
 * on navigation, so a mutation refresh or a new `?query=/kind=/tags=`
 * doesn't remount it — it stays mounted with whatever local state
 * (`editingId`, `expandedId`, etc.) it already had. `libraryItems`/`cursor`
 * are therefore resynced from the `items`/`nextCursor` props during render
 * (the same "adjust state during render" pattern `syncedSearchQuery` below
 * already uses, keyed off the `items` array's reference rather than a
 * scalar): `app/page.tsx` is a Server Component, so `items`/`nextCursor`
 * only get a new reference when it actually re-executes (a filter
 * navigation or a post-mutation `router.refresh()`) — a purely local
 * re-render (e.g. toggling `editingId`) leaves the reference stable, so this
 * can't loop or discard in-progress local state on every render.
 *
 * Stale-tag self-correction: `app/page.tsx` already strips any pruned tag
 * from `tagsFilter`/the data it fetched with (via `dropStaleTags`) before
 * this component ever sees it, so the rendered list/chips are correct from
 * first paint — `hasStaleTags` just says whether the *URL* still needs to
 * catch up (see the effect below). Unlike `FlashcardsManager`, this
 * component isn't remounted via a changing `key` on navigation, so the
 * effect re-runs on every prop update rather than "once per mount" — it's
 * still self-terminating: correcting the URL re-renders with
 * `hasStaleTags: false`, so it can't loop.
 */
export function ItemsLibrary({
  items,
  nextCursor,
  totalCount,
  currentUser,
  tagSuggestions,
  searchQuery,
  kindFilter,
  hasExplicitKindFilter,
  tagsFilter,
  hasStaleTags,
}: {
  items: SerializedItem[];
  nextCursor: string | null;
  totalCount: number;
  currentUser: SessionUser;
  tagSuggestions: string[];
  searchQuery: string;
  kindFilter: CreatableItemKind[];
  // Ticket 10: distinguishes the landing default (kindFilter defaults to
  // ["link","tool"] with no `kind=` params in the URL) from a real,
  // user-driven kind selection, so the empty-state message below doesn't
  // read "no items match your search" on a fresh landing that just happens
  // to have zero links/tools.
  hasExplicitKindFilter: boolean;
  tagsFilter: string[];
  hasStaleTags: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [editingId, setEditingId] = useState<string | null>(null);
  // Ticket 05: single-open invariant for the expand-to-overlay card, mirroring
  // `editingId` above. Only one card's overlay can be open at a time; expanding
  // a different card's toggle switches `expandedId` rather than stacking.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [queryInput, setQueryInput] = useState(searchQuery);
  const [libraryItems, setLibraryItems] = useState(items);
  const [cursor, setCursor] = useState(nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  // See the class doc comment above: resyncs `libraryItems`/`cursor` from
  // props whenever `items` gets a new reference (a real server refetch),
  // discarding any extra infinite-scroll pages and any stale loading/error
  // state from the previous filter's list.
  const [syncedItems, setSyncedItems] = useState(items);
  if (items !== syncedItems) {
    setSyncedItems(items);
    setLibraryItems(items);
    setCursor(nextCursor);
    setLoadingMore(false);
    setLoadMoreError(null);
  }

  const loadMore = useCallback(async () => {
    if (!cursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const response = await fetch(`/api/items?${buildLoadMoreQuery(cursor, searchQuery, kindFilter, tagsFilter)}`);
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const page: ItemsPageResponse = await response.json();
      setLibraryItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setLoadMoreError(err instanceof Error ? err.message : "Could not load more items");
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [cursor, searchQuery, kindFilter, tagsFilter]);

  // No more pages: no sentinel is rendered (see below), so this never
  // subscribes and no further fetches are ever triggered.
  useEffect(() => {
    if (!cursor) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cursor, loadMore]);
  // Ticket 03: the tag cloud's own live-narrowing search box, fully separate
  // from `queryInput` above (the item-text search box) — typing here never
  // touches the URL/item list, it only narrows which tag chips are visible.
  const [tagCloudFilter, setTagCloudFilter] = useState("");
  // Tracks the last `searchQuery` we've synced `queryInput` from, so a URL
  // change that didn't originate from this input (e.g. browser back/forward)
  // is reflected here too — adjusted during render rather than in an effect,
  // per React's guidance for state derived from a changing prop.
  const [syncedSearchQuery, setSyncedSearchQuery] = useState(searchQuery);
  if (searchQuery !== syncedSearchQuery) {
    setSyncedSearchQuery(searchQuery);
    setQueryInput(searchQuery);
  }
  // Computed independently of `TagFilterInput`'s own children render-prop
  // (see the search/tag-filter row below): the tag cloud renders in its own
  // full-width area, decoupled from wherever the narrower tag-filter input
  // itself is laid out, so it needs its own filtered list rather than one
  // handed to it via that render-prop.
  const visibleTagCloudTags = filterTagsByQuery(tagSuggestions, tagCloudFilter);

  const navigateToFilters = useCallback(
    (nextQuery: string, nextKinds: CreatableItemKind[], nextTags: string[]) => {
      const params = new URLSearchParams();
      if (nextQuery.trim()) params.set("query", nextQuery.trim());
      for (const kind of nextKinds) params.append("kind", kind);
      for (const tag of serializeTagsParam(nextTags)) params.append("tags", tag);
      const queryString = params.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname);
    },
    [router, pathname],
  );

  // Debounce navigation while the user is still typing, so every keystroke
  // doesn't trigger a server round trip. Also re-runs (cancelling any
  // pending navigation) when kindFilter/tagsFilter change, so an immediate
  // chip click can never be clobbered a moment later by a stale,
  // already-queued search-term navigation that closed over the previous
  // kind/tags.
  useEffect(() => {
    if (queryInput === searchQuery) return;
    const timeout = setTimeout(
      () => navigateToFilters(queryInput, kindFilter, tagsFilter),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timeout);
  }, [queryInput, kindFilter, tagsFilter, searchQuery, navigateToFilters]);

  // Silently corrects the URL when it still names a tag that's since been
  // pruned (see the class doc comment above) — the data/UI are already
  // correct by the time this runs, this just brings `?tags=` in the address
  // bar back in sync with it.
  useEffect(() => {
    if (hasStaleTags) navigateToFilters(searchQuery, kindFilter, tagsFilter);
  }, [hasStaleTags, tagsFilter, kindFilter, searchQuery, navigateToFilters]);

  // While a card is expanded: lock background scroll and let Escape dismiss
  // it (clicking the backdrop and the card's own toggle handle the other two
  // dismissal paths directly). Centralized here rather than per-`ItemRow` so
  // switching which card is expanded can never race two rows' effects into
  // leaving scroll locked or unlocked incorrectly.
  useEffect(() => {
    if (!expandedId) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [expandedId]);

  useEffect(() => {
    if (!expandedId) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setExpandedId(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [expandedId]);

  // Only clears editingId/expandedId if they belonged to the item that just
  // changed, so saving/deleting one card can't force-close an unrelated
  // card's still-open overlay (both stay usable simultaneously per ticket 05).
  function refresh(itemId: string) {
    setEditingId((current) => (current === itemId ? null : current));
    setExpandedId((current) => (current === itemId ? null : current));
    router.refresh();
  }

  function handleKindChipClick(kind: CreatableItemKind) {
    navigateToFilters(queryInput, toggleKindChip(kindFilter, kind), tagsFilter);
  }

  function handleTagChipClick(tag: string) {
    navigateToFilters(queryInput, kindFilter, toggleTagChip(tagsFilter, tag));
  }

  return (
    <section>
      <div className={styles.section}>
        <div className={styles.headingRow}>
          <Link className={styles.addItemLink} href="/items/new">
            <Plus size={14} aria-hidden="true" />
            Add item
          </Link>
        </div>
        {/*
         * A page-centered section title over the whole search/tag-filter row
         * below (not just the item search input) — sits outside `.searchArea`
         * so it centers against the full page-shell width (170ch, same as
         * `.tagCloudArea`) rather than just `.searchArea`'s narrower 66.666%.
         * Having it here also means both columns below only carry one label
         * line each (the instructional label / "Filter tags"), so their
         * input boxes line up without needing any extra spacer.
         */}
        <h2 className={`${styles.heading} ${styles.searchHeading}`}>Search</h2>
        <div className={styles.searchArea}>
          <div className={styles.searchRow}>
            <div className={styles.searchColumn}>
              <div className={styles.filterField}>
                <div
                  className={styles.searchInputWrap}
                  style={{ "--char-count": queryInput.length } as CSSProperties}
                >
                  <input
                    id="items-search"
                    className={styles.searchField}
                    type="search"
                    aria-label="Search titles, descriptions, notes, and tags"
                    placeholder="Search titles, descriptions, notes, and tags"
                    value={queryInput}
                    onChange={(event) => setQueryInput(event.target.value)}
                  />
                  <span className={styles.cursorCue} aria-hidden="true" />
                </div>
              </div>
            </div>
            <div className={styles.tagFilterColumn}>
              <TagFilterInput
                id="library-tag-filter"
                tags={tagSuggestions}
                value={tagCloudFilter}
                onChange={setTagCloudFilter}
                className={styles.tagFilterField}
              >
                {() => null}
              </TagFilterInput>
            </div>
          </div>
          <div className={styles.kindChipRow} role="group" aria-label="Filter by kind">
            {LIBRARY_ITEM_KINDS.map((kind) => (
              <button
                key={`kind-${kind}`}
                type="button"
                className={
                  kindFilter.includes(kind) ? `${styles.chip} ${styles.chipActive}` : styles.chip
                }
                aria-pressed={kindFilter.includes(kind)}
                onClick={() => handleKindChipClick(kind)}
              >
                {kindBadgeLabel(kind)}
              </button>
            ))}
          </div>
        </div>
        {/*
         * Ticket 03: kept separate from `.searchArea` (which caps the search
         * row and kind-chip row at 66.666% width) in its own wrapper capped
         * at 170ch, matching the study page's tag-selection panel width, so
         * the tag cloud can span far more of the page shell than before.
         * Deliberately independent of the tag-filter input above (now in
         * `.searchRow`, beside the item search box): `visibleTagCloudTags` is
         * computed once, near the other state, and handed to `TagCloud`
         * directly here rather than via `TagFilterInput`'s own children
         * render-prop, precisely so this cloud's position/width never has to
         * follow wherever the input itself is laid out.
         */}
        <div className={styles.tagCloudArea}>
          {visibleTagCloudTags.length > 0 && (
            <TagCloud
              tags={visibleTagCloudTags}
              selectedTags={tagsFilter}
              onToggle={handleTagChipClick}
              ariaLabel="Filter by tags"
            />
          )}
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.heading}>Items ({totalCount})</h2>
        {libraryItems.length === 0 && (
          <div className={styles.empty}>
            <Inbox size={32} aria-hidden="true" />
            <p>
              {searchQuery || hasExplicitKindFilter || tagsFilter.length > 0
                ? "No items match your search."
                : "No items yet."}
            </p>
          </div>
        )}
        {expandedId && (
          <div className={styles.backdrop} onClick={() => setExpandedId(null)} />
        )}
        <ul className={styles.itemList}>
          {libraryItems.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              canModify={currentUser.role === "admin" || currentUser.id === item.createdBy}
              isAdmin={currentUser.role === "admin"}
              isEditing={editingId === item.id}
              onEditToggle={() => setEditingId(editingId === item.id ? null : item.id)}
              isExpanded={expandedId === item.id}
              onExpandToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
              isInert={expandedId !== null && expandedId !== item.id}
              onChanged={() => refresh(item.id)}
              tagSuggestions={tagSuggestions}
            />
          ))}
          {cursor && (
            <li ref={sentinelRef} className={styles.sentinel} aria-hidden="true">
              {loadingMore && <span className={styles.loadingMore}>Loading more…</span>}
            </li>
          )}
        </ul>
        {loadMoreError && (
          <p role="alert" className={styles.error}>
            {loadMoreError}
          </p>
        )}
      </div>
    </section>
  );
}
