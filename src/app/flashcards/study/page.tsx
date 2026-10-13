import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/current-user";
import { dropStaleTags, parseTagsParam } from "@/app/items/chip-filters";
import { listFlashcards } from "@/services/flashcards/flashcards";
import { listFlashcardTags } from "@/services/tags/tags";
import { Header } from "@/app/Header";
import { Wordmark } from "@/app/Wordmark";
import shellStyles from "@/app/page-shell.module.css";
import { serializeFlashcard } from "@/app/flashcards/types";
import { StudySession } from "./StudySession";

/**
 * Server component gated the same way every other page is; both the
 * flashcard pool and the tag list are fetched once here and handed to the
 * client StudySession component, which owns all session state (tag
 * selection, shuffled deck, current index, flip state) so starting or
 * restarting a session needs no further network round trip.
 *
 * `?tags=` (set by `/flashcards`'s [STUDY] link from its own tag filter)
 * pre-selects those tags on the selection screen — stripped of any tag no
 * longer attached to a flashcard via `dropStaleTags`, same as `/flashcards`.
 */
export default async function StudyPage({
  searchParams,
}: {
  searchParams: Promise<{ tags?: string | string[] }>;
}) {
  const user = await requireCurrentUser();
  const { tags: tagsParam } = await searchParams;

  const db = getDb();
  // No `limit`: the study deck needs the entire pool up front to shuffle
  // from, unlike the paginated `/flashcards` management list (ticket 04).
  // `listFlashcardTags` (ticket 05) scopes the tag-selection cloud to tags
  // attached to at least one flashcard, excluding item-only tags.
  const [flashcardsPage, tags] = await Promise.all([listFlashcards(db), listFlashcardTags(db)]);
  const flashcards = flashcardsPage.flashcards.map(serializeFlashcard);
  const initialSelectedTags = dropStaleTags(parseTagsParam(tagsParam), tags);

  return (
    <main className={shellStyles.shell}>
      <h1>
        <Wordmark />
      </h1>
      <Header user={user} />
      <StudySession flashcards={flashcards} tags={tags} initialSelectedTags={initialSelectedTags} />
    </main>
  );
}
