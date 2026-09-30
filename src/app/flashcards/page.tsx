import { randomUUID } from "node:crypto";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/current-user";
import { dropStaleTags, parseTagsParam } from "@/app/items/chip-filters";
import { countFlashcards, listFlashcards } from "@/services/flashcards/flashcards";
import { FLASHCARDS_PAGE_SIZE } from "@/services/flashcards/pagination";
import { listFlashcardTags } from "@/services/tags/tags";
import { Header } from "@/app/Header";
import { Wordmark } from "@/app/Wordmark";
import shellStyles from "@/app/page-shell.module.css";
import { FlashcardsManager } from "./FlashcardsManager";
import { serializeFlashcard } from "./types";

/**
 * The flashcards management view: every flashcard in the workspace (not
 * just the current user's), full CRUD subject to `flashcards.ts`'s
 * open-edit/creator-or-admin-delete rules. Fetches directly via the service layer, same
 * data-fetch pattern as `/wiki/layout.tsx` and `/` (`app/page.tsx`) — only
 * the first `FLASHCARDS_PAGE_SIZE` cards, though (ticket 04): this keeps the
 * first paint synchronous/flash-free while handing the rest of the pool off
 * to `FlashcardsManager`'s client-side infinite scroll.
 *
 * Tag filtering (ticket 05): the selected tags live in the URL (`?tags=`),
 * matching `/` (`app/page.tsx`)'s existing convention — parsed here via the
 * same `parseTagsParam` (cross-folder import, same pattern `TagFilterInput`
 * already established) and passed straight into `listFlashcards`'s existing
 * OR-filter, so the SSR'd first page already reflects the filter with no
 * unfiltered flash before the client takes over.
 *
 * Self-healing against a pruned selected tag: a tag selected in the URL can
 * be deleted out from under the filter (its last flashcard reference
 * removed prunes the tag row entirely — see pruneUnusedTags), leaving the
 * URL referencing a tag `tagSuggestions` no longer contains. `dropStaleTags`
 * strips any such tag from what's actually queried/rendered on every
 * render (not just right after a delete, so it also self-heals a stale
 * bookmarked/shared URL); `FlashcardsManager` corrects the visible URL to
 * match once mounted, via `hasStaleTags`.
 */
export default async function FlashcardsPage({
  searchParams,
}: {
  searchParams: Promise<{ tags?: string | string[] }>;
}) {
  const user = await requireCurrentUser();

  const { tags: tagsParam } = await searchParams;
  const requestedTagsFilter = parseTagsParam(tagsParam);

  const db = getDb();
  // Scoped to tags attached to at least one flashcard (ticket 05) — an
  // item-only tag would otherwise render as a chip guaranteed to match
  // nothing here.
  const tagSuggestions = await listFlashcardTags(db);
  const tagsFilter = dropStaleTags(requestedTagsFilter, tagSuggestions);
  const hasStaleTags = tagsFilter.length !== requestedTagsFilter.length;

  const tagsOption = tagsFilter.length > 0 ? tagsFilter : undefined;
  // True total (ticket 01), fetched alongside the SSR first page rather
  // than derived from it: `countFlashcards` reuses the same tag filter as
  // `listFlashcards` but is independent of `limit`/`cursor`, so it reflects
  // the whole matching set, not just this first page's length.
  const [firstPage, total] = await Promise.all([
    listFlashcards(db, { limit: FLASHCARDS_PAGE_SIZE, tags: tagsOption }),
    countFlashcards(db, { tags: tagsOption }),
  ]);
  const flashcards = firstPage.flashcards.map(serializeFlashcard);

  return (
    <main className={`${shellStyles.shell} ${shellStyles.wide}`}>
      <h1>
        <Wordmark />
      </h1>
      <Header user={user} />
      {/*
        `key` is fresh on every render of this server component (including
        the one `router.refresh()` triggers after a create/edit/delete, and
        every tag-filter navigation to a new `?tags=` URL — ticket 05), so
        FlashcardsManager fully remounts with the new first page as its
        initial state instead of an effect syncing a changed prop into
        state — see its docstring.
      */}
      <FlashcardsManager
        key={randomUUID()}
        flashcards={flashcards}
        nextCursor={firstPage.nextCursor}
        currentUser={user}
        tagSuggestions={tagSuggestions}
        tagsFilter={tagsFilter}
        hasStaleTags={hasStaleTags}
        total={total}
      />
    </main>
  );
}
