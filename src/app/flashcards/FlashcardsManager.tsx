"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { GraduationCap, Layers, Plus } from "lucide-react";
import { serializeTagsParam, toggleTagChip } from "@/app/items/chip-filters";
import { TagCloud } from "@/app/TagCloud";
import { TagFilterInput } from "@/app/TagFilterInput";
import { readErrorMessage } from "@/lib/http-client";
import type { SessionUser } from "@/services/auth/session";
import { FLASHCARDS_PAGE_SIZE } from "@/services/flashcards/pagination";
import { FlashcardRow } from "./FlashcardRow";
import type { SerializedFlashcard } from "./types";
import styles from "./FlashcardsManager.module.css";

interface FlashcardsPageResponse {
  flashcards: SerializedFlashcard[];
  nextCursor: string | null;
  // The true, tag-filter-scoped total (ticket 01). Every page (including a
  // `loadMore` fetch) carries the same value for a given filter, so it's
  // read once from the initial SSR `total` prop below rather than re-synced
  // from each `loadMore` response — see the component doc comment.
  total: number;
}

/**
 * Query string for GET /api/flashcards's next page: the cursor plus the
 * default page size, and the current tag filter appended as repeated
 * `tags=` params (OR semantics, same as the initial SSR fetch) — so
 * infinite scroll keeps paging through the *filtered* result set instead of
 * silently falling back to the unfiltered one (ticket 05). Exported for
 * direct unit testing, no DOM/fetch needed — mirrors route.ts pulling out
 * parseLimitParam for the same reason.
 */
export function buildLoadMoreQuery(cursor: string, tagsFilter: string[]): string {
  const params = new URLSearchParams({ limit: String(FLASHCARDS_PAGE_SIZE), cursor });
  for (const tag of serializeTagsParam(tagsFilter)) params.append("tags", tag);
  return params.toString();
}

/**
 * URL (path + `?tags=` query string, or the bare pathname once no tags are
 * selected) for a given tag selection — the flashcards list's URL-driven
 * filter state (ticket 05). Exported for direct unit testing; also the
 * building block `buildTagFilterUrl` (toggling one chip) and the
 * stale-tag-correction effect below (replacing with an already-resolved
 * selection) both reduce to.
 */
export function buildTagsUrl(pathname: string, tagsFilter: string[]): string {
  const params = new URLSearchParams();
  for (const tag of serializeTagsParam(tagsFilter)) params.append("tags", tag);
  const queryString = params.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

/**
 * URL to navigate to after toggling a tag chip, mirroring ItemsLibrary's
 * `navigateToFilters`/`handleTagChipClick`. Reuses the same OR-toggle
 * (`toggleTagChip`) as the Library page rather than reimplementing it.
 * Exported for direct unit testing.
 */
export function buildTagFilterUrl(pathname: string, tagsFilter: string[], clickedTag: string): string {
  return buildTagsUrl(pathname, toggleTagChip(tagsFilter, clickedTag));
}

/**
 * The flashcards management view: every flashcard in the workspace (not
 * just the current user's), and per-row inline edit/delete (see
 * FlashcardRow). Creating a flashcard lives on its own page (`/flashcards/new`,
 * reached via `[ADD FLASHCARD]` below), mirroring how `/items/new` works for
 * items.
 *
 * Hybrid SSR + infinite scroll (ticket 04): `flashcards`/`nextCursor` are
 * the server-rendered first page (see `page.tsx`); `items`/`cursor` state
 * seeds from them once on mount and grows as `loadMore` fetches subsequent
 * pages from the paginated `GET /api/flashcards` while a sentinel `<li>`
 * near the end of the list is on-screen (see the `IntersectionObserver`
 * effect below). A mutation still fully refreshes the list back to page 1
 * rather than patching already-loaded pages in place: `page.tsx` mounts
 * this component with a fresh `key` on every `router.refresh()`, which
 * remounts it outright (discarding `items`/`cursor`/`editingId`, etc.) with
 * the new server-rendered first page as its initial state — no effect
 * syncing a prop into state, which React (and this repo's
 * `react-hooks/set-state-in-effect` lint rule) flags as cascading-render-prone.
 *
 * Tag filtering (ticket 05): `tagsFilter` is the URL-driven selection
 * `page.tsx` already parsed and filtered the SSR first page by (mirroring
 * `ItemsLibrary`'s convention). Toggling a chip navigates to a new
 * `?tags=` URL via `router.replace` rather than touching local state
 * directly — that navigation is what makes `page.tsx` re-render with a
 * fresh `key`, remounting this component and discarding any extra pages
 * loaded via infinite scroll under the old filter, exactly the same
 * discard-and-reseed mechanism described above for a mutation refresh.
 * `loadMore` carries the same `tagsFilter` on every subsequent-page fetch
 * so scrolling keeps paging through the filtered set.
 *
 * Stale-tag self-correction: `page.tsx` already strips any pruned tag from
 * `tagsFilter`/the data it fetched with (via `dropStaleTags`) before this
 * component ever mounts, so the rendered list/chips are correct from first
 * paint — `hasStaleTags` just says whether the *URL* still needs to catch
 * up. The effect below fires once per mount and replaces it via the same
 * `buildTagsUrl` a chip click uses, which — like any URL change here —
 * triggers `page.tsx` to re-render with a fresh `key`, remounting this
 * component; that second mount recomputes `hasStaleTags` as false (the URL
 * is clean now), so this can't loop.
 *
 * True count heading (ticket 01): `total` is `page.tsx`'s SSR-fetched real
 * `COUNT(*)` (via `countFlashcards`, same tag filter as `flashcards`), not
 * `items.length` — so "Flashcards (N)" shows the actual workspace/filtered
 * total from first paint and doesn't drift as `loadMore` grows `items`
 * during infinite scroll. It's read directly as a prop rather than mirrored
 * into state: like `flashcards`/`nextCursor`, it's only ever fresh on a
 * remount (a new SSR `key`), so there's nothing for an effect to
 * resync — `loadMore`'s own response carries the same `total` for the
 * active filter but that value is intentionally not applied to anything.
 */
export function FlashcardsManager({
  flashcards,
  nextCursor,
  currentUser,
  tagSuggestions,
  tagsFilter,
  hasStaleTags,
  total,
}: {
  flashcards: SerializedFlashcard[];
  nextCursor: string | null;
  currentUser: SessionUser;
  tagSuggestions: string[];
  tagsFilter: string[];
  hasStaleTags: boolean;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [editingId, setEditingId] = useState<string | null>(null);
  // Ticket 02: single-open invariant for the expand-to-overlay card,
  // mirroring ItemsLibrary.tsx's own `expandedId`.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [items, setItems] = useState(flashcards);
  const [cursor, setCursor] = useState(nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  // The tag cloud's own live-narrowing search box (typing here never
  // touches the URL/flashcard list, only which chips are visible) — same
  // separation as ItemsLibrary's `tagCloudFilter`.
  const [tagCloudFilter, setTagCloudFilter] = useState("");
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLLIElement | null>(null);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const response = await fetch(`/api/flashcards?${buildLoadMoreQuery(cursor, tagsFilter)}`);
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const page: FlashcardsPageResponse = await response.json();
      setItems((current) => [...current, ...page.flashcards]);
      setCursor(page.nextCursor);
    } catch (err) {
      setLoadMoreError(err instanceof Error ? err.message : "Could not load more flashcards");
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [cursor, tagsFilter]);

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

  // While a card is expanded: lock background scroll and let Escape dismiss
  // it (clicking the backdrop and the card's own toggle handle the other two
  // dismissal paths directly) — mirroring ItemsLibrary.tsx.
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

  // Silently corrects the URL when it still names a tag that's since been
  // pruned (see the class doc comment above) — the data/UI are already
  // correct by the time this runs, this just brings `?tags=` in the address
  // bar back in sync with it.
  useEffect(() => {
    if (hasStaleTags) router.replace(buildTagsUrl(pathname, tagsFilter));
  }, [hasStaleTags, tagsFilter, pathname, router]);

  function refresh(flashcardId: string) {
    setEditingId((current) => (current === flashcardId ? null : current));
    setExpandedId((current) => (current === flashcardId ? null : current));
    router.refresh();
  }

  function handleTagChipClick(tag: string) {
    router.replace(buildTagFilterUrl(pathname, tagsFilter, tag));
  }

  return (
    <section>
      <div className={styles.section}>
        <div className={styles.headingRow}>
          <h2 className={styles.heading}>Flashcards ({total})</h2>
          <div className={styles.actionLinks}>
            <Link className={styles.actionLink} href="/flashcards/new">
              <Plus size={14} aria-hidden="true" />
              Add flashcard
            </Link>
            <Link className={styles.actionLink} href="/flashcards/study">
              <GraduationCap size={14} aria-hidden="true" />
              Study
            </Link>
          </div>
        </div>
        <div className={styles.tagCloudArea}>
          <TagFilterInput
            id="flashcards-tag-filter"
            tags={tagSuggestions}
            value={tagCloudFilter}
            onChange={setTagCloudFilter}
            className={styles.tagFilterField}
          >
            {(visibleTags) => (
              <TagCloud
                tags={visibleTags}
                selectedTags={tagsFilter}
                onToggle={handleTagChipClick}
                ariaLabel="Filter by tags"
              />
            )}
          </TagFilterInput>
        </div>
        {items.length === 0 && (
          <div className={styles.empty}>
            <Layers size={32} aria-hidden="true" />
            <p>{tagsFilter.length > 0 ? "No flashcards match the selected tags." : "No flashcards yet."}</p>
          </div>
        )}
        {expandedId && <div className={styles.backdrop} onClick={() => setExpandedId(null)} />}
        <ul className={styles.flashcardList}>
          {items.map((flashcard) => (
            <FlashcardRow
              key={flashcard.id}
              flashcard={flashcard}
              currentUser={currentUser}
              isEditing={editingId === flashcard.id}
              onEditToggle={() => setEditingId(editingId === flashcard.id ? null : flashcard.id)}
              isExpanded={expandedId === flashcard.id}
              onExpandToggle={() => setExpandedId(expandedId === flashcard.id ? null : flashcard.id)}
              isInert={expandedId !== null && expandedId !== flashcard.id}
              onChanged={() => refresh(flashcard.id)}
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
