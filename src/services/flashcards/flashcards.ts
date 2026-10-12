import { and, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { flashcardTags, flashcards, tags, users } from "@/db/schema";
import { isUniqueViolation } from "@/lib/db-errors";
import { sha256Hex } from "@/lib/crypto";
import { getLogger } from "@/lib/logging";
import { NotFoundError, UnauthorizedError, ValidationError } from "@/services/errors";
import type { SessionUser } from "@/services/auth/session";
import { createCursorPagination } from "@/services/cursor-pagination";
import { changedFieldNames, logMutationFailure, logMutationSuccess } from "@/services/mutation-log";
import { canDeleteFlashcard } from "@/services/flashcards/permissions";
import {
  getTagNamesForFlashcards,
  normalizeTagName,
  normalizeTagNames,
  pruneUnusedTags,
  setFlashcardTags,
} from "@/services/tags/tags";
import { hasTags, TAGS_REQUIRED_ERROR } from "@/services/tags/validation";

const logger = getLogger(["pensieve", "flashcards"]);
const ENTITY = "flashcards";

// Ticket 26 moved this to client-safe permissions.ts; re-exported for server callers.
export { canDeleteFlashcard };

export type Flashcard = typeof flashcards.$inferSelect;

export interface FlashcardWithCreator extends Flashcard {
  createdByName: string;
  tags: string[];
}

export interface CreateFlashcardInput {
  creatorId: string;
  front: string;
  back: string;
  // Free-form citation text (ticket 04) — required, shown alongside the
  // answer during study rather than inlined into `back`.
  source: string;
  // Freeform tag names, normalized and reused by name against the shared
  // tag pool (see src/services/tags/tags.ts). At least one non-blank tag is
  // required (ticket 04) — createFlashcard rejects with a ValidationError
  // when this is omitted or normalizes to empty (see normalizeTagNames).
  // Optional only in the type sense that omitting it is itself an error,
  // the same way an omitted required string field would be.
  tags?: string[];
}

/**
 * Runs `insertOrUpdate` (an insert/update against `flashcards` alone,
 * nothing else) and converts a frontHash unique-constraint violation into a
 * friendly ValidationError. Kept to just that one statement — not wrapped
 * around tag assignment too — so an unrelated failure there is never
 * mislabeled as a duplicate-question error.
 */
async function runOrThrowOnDuplicateFront<T>(insertOrUpdate: () => Promise<T>): Promise<T> {
  try {
    return await insertOrUpdate();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ValidationError("A flashcard with this exact question already exists");
    }
    throw err;
  }
}

/**
 * Creates a flashcard; delegates to setFlashcardTags the same way
 * createItem delegates to setItemTags. `frontHash` (ticket 04) is derived
 * here, never accepted as caller input — it's a pure function of `front`,
 * so there's nothing for a caller to independently specify.
 *
 * At least one tag is required (ticket 04): `input.tags` is run through the
 * same normalize/dedup/blank-filter setFlashcardTags itself applies (see
 * normalizeTagNames), and a result of zero tags — whether `tags` was
 * omitted, `[]`, or every name was blank/whitespace-only — is rejected with
 * a ValidationError before anything is written, rather than silently
 * creating an untagged card.
 */
export async function createFlashcard(db: Database, input: CreateFlashcardInput): Promise<Flashcard> {
  // Set once the insert succeeds, so a later failure (e.g. tag assignment)
  // still logs the id it created — a failure before the insert genuinely
  // has no id to log.
  let insertedId: string | undefined;
  try {
    const normalizedTags = normalizeTagNames(input.tags ?? []);
    if (!hasTags(normalizedTags)) {
      throw new ValidationError(TAGS_REQUIRED_ERROR);
    }

    const [row] = await runOrThrowOnDuplicateFront(() =>
      db
        .insert(flashcards)
        .values({
          front: input.front,
          back: input.back,
          source: input.source,
          frontHash: sha256Hex(input.front.trim()),
          createdBy: input.creatorId,
        })
        .returning(),
    );
    insertedId = row.id;

    await setFlashcardTags(db, row.id, normalizedTags);

    logMutationSuccess(logger, "Flashcard created", { entity: ENTITY, entityId: row.id });
    return row;
  } catch (error) {
    // `entityId` is only present once the insert above has actually
    // succeeded — a failure before that point has no row/id to log.
    logMutationFailure(logger, "Flashcard creation failed", { entity: ENTITY, entityId: insertedId }, error);
    throw error;
  }
}

export async function getFlashcard(db: Database, id: string): Promise<Flashcard> {
  const [row] = await db.select().from(flashcards).where(eq(flashcards.id, id));
  if (!row) {
    throw new NotFoundError("Flashcard not found");
  }
  return row;
}

export interface UpdateFlashcardInput {
  front?: string;
  back?: string;
  // Free-form citation text (ticket 04).
  source?: string;
  // When provided, replaces the flashcard's full tag set (omit to leave the
  // current tags untouched — same convention as items.ts). An explicit
  // array that normalizes to empty (ticket 04 — see normalizeTagNames) is
  // rejected with a ValidationError: a flashcard's last tag can't be
  // removed this way, unlike omitting `tags` entirely.
  tags?: string[];
}

/**
 * Updates a flashcard's fields. Deliberately open-edit: any authenticated
 * actor may update any flashcard, with no ownership/role check at all — the
 * explicit divergence from items.ts's canModifyItem the spec calls for.
 * Updating `front` recomputes `frontHash` in lockstep (ticket 04) so the
 * column never drifts out of sync with the text it's derived from; a
 * duplicate trimmed `front` surfaces as a friendly ValidationError, same as
 * createFlashcard. When `updates.tags` is provided (ticket 04), it must
 * normalize to at least one tag — see normalizeTagNames and
 * UpdateFlashcardInput's `tags` docstring; omitting `tags` entirely still
 * always leaves the current tags untouched.
 */
export async function updateFlashcard(
  db: Database,
  // Unused: any authenticated actor may update any flashcard (see docstring
  // above), but the parameter is kept for signature symmetry with
  // items.ts's updateItem(db, actor, id, updates) and so a future permission
  // rule wouldn't be a breaking signature change.
  _actor: SessionUser,
  id: string,
  updates: UpdateFlashcardInput,
): Promise<Flashcard> {
  try {
    const flashcard = await getFlashcard(db, id);

    const { tags: tagNames, ...columnUpdates } = updates;
    const normalizedTags = tagNames !== undefined ? normalizeTagNames(tagNames) : undefined;
    if (normalizedTags !== undefined && !hasTags(normalizedTags)) {
      throw new ValidationError(TAGS_REQUIRED_ERROR);
    }

    // Ticket 09: reuses the pre-update row already fetched above (via
    // getFlashcard) — field *names* only, never old/new values. Diffed
    // against columnUpdates (front/back/source) before frontHash — a
    // derived field never present in the caller's payload — is added below.
    const changedFields = changedFieldNames(flashcard, columnUpdates);

    const values = {
      ...columnUpdates,
      ...(columnUpdates.front !== undefined ? { frontHash: sha256Hex(columnUpdates.front.trim()) } : {}),
      updatedAt: new Date(),
    };

    const [row] = await runOrThrowOnDuplicateFront(() =>
      db.update(flashcards).set(values).where(eq(flashcards.id, id)).returning(),
    );

    if (normalizedTags !== undefined) {
      await setFlashcardTags(db, id, normalizedTags);
    }

    logMutationSuccess(logger, "Flashcard updated", { entity: ENTITY, entityId: id, changedFields });
    return row;
  } catch (error) {
    logMutationFailure(logger, "Flashcard update failed", { entity: ENTITY, entityId: id }, error);
    throw error;
  }
}

/**
 * Deletes a flashcard. Permitted for its creator or an admin (see
 * canDeleteFlashcard). Mirrors deleteItem: captures this flashcard's tag ids
 * before deleting it, then prunes any of them left with zero remaining
 * references (see pruneUnusedTags) so the shared tag pool doesn't accumulate
 * orphans.
 */
export async function deleteFlashcard(db: Database, actor: SessionUser, id: string): Promise<void> {
  try {
    const flashcard = await getFlashcard(db, id);
    if (!canDeleteFlashcard(actor, flashcard)) {
      throw new UnauthorizedError("You do not have permission to delete this flashcard");
    }

    const flashcardTagRows = await db
      .select({ tagId: flashcardTags.tagId })
      .from(flashcardTags)
      .where(eq(flashcardTags.flashcardId, id));
    await db.delete(flashcards).where(eq(flashcards.id, id));
    await pruneUnusedTags(
      db,
      flashcardTagRows.map((row) => row.tagId),
    );

    logMutationSuccess(logger, "Flashcard deleted", { entity: ENTITY, entityId: id });
  } catch (error) {
    logMutationFailure(logger, "Flashcard deletion failed", { entity: ENTITY, entityId: id }, error);
    throw error;
  }
}

export interface ListFlashcardsOptions {
  // Tag filtering: a flashcard matches if it carries at least one tag whose
  // name is in this list (OR semantics). Omit or pass an empty array for no
  // narrowing (every flashcard).
  tags?: string[];
  // Keyset pagination (ticket 04): when omitted, every matching flashcard is
  // returned in one page (the pre-pagination behavior — still relied on by
  // the study deck, which needs the whole pool up front). When given, at
  // most `limit` flashcards are returned per call.
  limit?: number;
  // Opaque cursor from a previous call's `nextCursor`. Omit for the first
  // page.
  cursor?: string;
}

export interface FlashcardsPage {
  flashcards: FlashcardWithCreator[];
  // Opaque cursor to pass as `cursor` to fetch the next page, or null when
  // this was the last page (or no `limit` was given at all).
  nextCursor: string | null;
}

/**
 * Keyset pagination bound to flashcards' (createdAt, id) — see
 * src/services/cursor-pagination.ts for the shared implementation
 * (identical to items.ts's, differing only in which table it binds to).
 */
const flashcardCursorPagination = createCursorPagination(flashcards.createdAt, flashcards.id);

/**
 * True when this flashcard carries at least one tag whose name is in
 * `tagNames` — the same correlated EXISTS-subquery shape items.ts's
 * itemHasAnyTag uses, adapted to flashcardTags.
 */
function flashcardHasAnyTag(tagNames: string[]): SQL {
  const normalizedNames = tagNames.map(normalizeTagName);
  return sql`exists (
    select 1 from ${flashcardTags}
    inner join ${tags} on ${tags.id} = ${flashcardTags.tagId}
    where ${flashcardTags.flashcardId} = ${flashcards.id} and ${inArray(tags.name, normalizedNames)}
  )`;
}

/**
 * Every flashcard in the workspace (not scoped to the caller), newest
 * first — so a just-created/edited card lands on page 1, which
 * "create/edit/delete refreshes back to page 1" (ticket 04) depends on to
 * actually show the change — with each creator's display name resolved
 * (mirroring ItemWithCreator). Optionally narrowed by a `tags` OR-filter
 * and/or keyset-paginated via `limit`/`cursor` (ticket 04) — see
 * `ListFlashcardsOptions`.
 */
export async function listFlashcards(
  db: Database,
  options: ListFlashcardsOptions = {},
): Promise<FlashcardsPage> {
  const conditions: SQL[] = [];
  if (options.tags && options.tags.length > 0) {
    conditions.push(flashcardHasAnyTag(options.tags));
  }
  if (options.cursor !== undefined) {
    conditions.push(flashcardCursorPagination.afterCursor(flashcardCursorPagination.decode(options.cursor)));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const query = db
    .select({
      id: flashcards.id,
      front: flashcards.front,
      back: flashcards.back,
      frontHash: flashcards.frontHash,
      source: flashcards.source,
      createdBy: flashcards.createdBy,
      createdByName: users.displayName,
      createdAt: flashcards.createdAt,
      updatedAt: flashcards.updatedAt,
    })
    .from(flashcards)
    .innerJoin(users, eq(flashcards.createdBy, users.id))
    .where(where)
    .orderBy(desc(flashcardCursorPagination.orderKey()), desc(flashcards.id));

  const { limit } = options;
  // Fetch one extra row (when paginating) purely to tell "exactly `limit`
  // rows left" apart from "more remain" — sliced back off below.
  const rows = limit !== undefined ? await query.limit(limit + 1) : await query;
  const hasMore = limit !== undefined && rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const tagsByFlashcard = await getTagNamesForFlashcards(
    db,
    pageRows.map((row) => row.id),
  );

  const pageFlashcards = pageRows.map((row) => ({ ...row, tags: tagsByFlashcard.get(row.id) ?? [] }));
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow
      ? flashcardCursorPagination.encode({ createdAt: lastRow.createdAt.toISOString(), id: lastRow.id })
      : null;

  return { flashcards: pageFlashcards, nextCursor };
}

export interface CountFlashcardsOptions {
  // Same OR-semantics tag filter as `ListFlashcardsOptions.tags` — pass the
  // same value used for a `listFlashcards` call to count only the same
  // filtered set (ticket 01).
  tags?: string[];
}

/**
 * True `COUNT(*)` of every flashcard matching the same tag filter
 * `listFlashcards` applies (reusing `flashcardHasAnyTag` for identical
 * semantics), independent of any `limit`/`cursor` — a real database count
 * rather than the length of whatever page happens to be loaded, so the
 * client can show a stable, filter-scoped total that doesn't grow as more
 * pages are fetched (ticket 01: replaces the "Flashcards (N)" heading's
 * previous `items.length`-derived N).
 */
export async function countFlashcards(
  db: Database,
  options: CountFlashcardsOptions = {},
): Promise<number> {
  const conditions: SQL[] = [];
  if (options.tags && options.tags.length > 0) {
    conditions.push(flashcardHasAnyTag(options.tags));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(flashcards)
    .where(where);

  return row?.count ?? 0;
}
