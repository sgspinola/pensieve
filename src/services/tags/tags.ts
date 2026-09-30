import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { flashcardTags, itemTags, items, tags } from "@/db/schema";
import { getLogger } from "@/lib/logging";
import { logMutationFailure, logMutationSuccess } from "@/services/mutation-log";

const logger = getLogger(["pensieve", "tags"]);
const ENTITY = "tags";

/**
 * Canonical form a tag name is stored/matched under: trimmed, internal
 * whitespace collapsed to a single space, lowercased. Applying this before
 * every lookup/insert is what makes "Machine Learning" and "machine
 * learning" resolve to the same tag row instead of near-duplicates
 * accumulating (see the `tags.name` unique constraint in src/db/schema.ts).
 */
export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Normalizes a raw list of tag names the way setItemTags/setFlashcardTags
 * actually store them: each name run through normalizeTagName, then
 * blank/whitespace-only names dropped and duplicates collapsed. Exported so
 * callers that need to know ahead of time whether a given `tags` list would
 * end up empty (e.g. createFlashcard/updateFlashcard's "at least one tag"
 * validation, ticket 04) use this exact same rule rather than a
 * hand-rolled copy that could drift from what setFlashcardTags itself does.
 */
export function normalizeTagNames(tagNames: string[]): string[] {
  return [...new Set(tagNames.map(normalizeTagName).filter((name) => name.length > 0))];
}

/** Every tag name that exists in the workspace, for autocomplete. */
export async function listTags(db: Database): Promise<string[]> {
  const rows = await db.select({ name: tags.name }).from(tags).orderBy(asc(tags.name));
  return rows.map((row) => row.name);
}

/**
 * Tag names to offer as the library's filter chips: a tag qualifies only
 * when it's attached to at least one non-page item. This single condition
 * does double duty as both exclusion rules the library needs (ticket 05):
 * a tag used only on wiki pages (`kind: "page"`) is excluded — the library
 * hard-excludes page items (see items.ts's LIBRARY_ITEM_KINDS), so such a
 * chip would otherwise match nothing — and a tag with no item usage at all
 * (e.g. flashcard-only) is excluded too, since a flashcard-only tag has no
 * non-page item usage either. A tag used by both a page and a non-page item
 * still qualifies (the non-page usage alone is enough).
 */
export async function listLibraryTags(db: Database): Promise<string[]> {
  const rows = await db
    .select({ name: tags.name })
    .from(tags)
    .where(sql`
      exists (
        select 1 from ${itemTags}
        inner join ${items} on ${items.id} = ${itemTags.itemId}
        where ${itemTags.tagId} = ${tags.id} and ${items.kind} != 'page'
      )
    `)
    .orderBy(asc(tags.name));
  return rows.map((row) => row.name);
}

/**
 * Tag names to offer as the flashcards/study tag clouds' filter chips
 * (ticket 05): everything `listTags` would return, except a tag with no
 * flashcard usage at all (e.g. item-only) — mirrors `listLibraryTags`'s own
 * domain-scoping, just against `flashcardTags` instead of `itemTags`/`items`.
 */
export async function listFlashcardTags(db: Database): Promise<string[]> {
  const rows = await db
    .select({ name: tags.name })
    .from(tags)
    .where(sql`
      exists (
        select 1 from ${flashcardTags}
        where ${flashcardTags.tagId} = ${tags.id}
      )
    `)
    .orderBy(asc(tags.name));
  return rows.map((row) => row.name);
}

/**
 * Finds the tag row for a normalized name, creating it if it doesn't exist
 * yet. Races against a concurrent first-use of the same name are handled by
 * the `tags.name` unique constraint: if this insert loses the race, it
 * falls back to selecting the row the winner just created rather than
 * throwing.
 */
async function findOrCreateTag(db: Database, normalizedName: string): Promise<{ id: string }> {
  const [existing] = await db.select({ id: tags.id }).from(tags).where(eq(tags.name, normalizedName));
  if (existing) return existing;

  try {
    const [inserted] = await db
      .insert(tags)
      .values({ name: normalizedName })
      .onConflictDoNothing()
      .returning({ id: tags.id });
    if (inserted) {
      logMutationSuccess(logger, "Tag created", { entity: ENTITY, entityId: inserted.id });
      return inserted;
    }
  } catch (error) {
    logMutationFailure(logger, "Tag creation failed", { entity: ENTITY }, error);
    throw error;
  }

  // Insert lost the unique-name race — fall back to the row the winner just
  // created rather than logging a spurious "create" for a row this call
  // never actually inserted.
  const [row] = await db.select({ id: tags.id }).from(tags).where(eq(tags.name, normalizedName));
  return row;
}

/**
 * Replaces an item's full set of tags with `tagNames` — the same "provide
 * the whole value" convention every other editable item field uses, so
 * removing a tag is just leaving it out of the next call. Names are
 * normalized and deduplicated first, and reuse an existing tag row by name
 * rather than creating a duplicate (see normalizeTagName/findOrCreateTag).
 * Blank/whitespace-only names are silently dropped. Any tag this item
 * dropped that's left with no items referencing it is deleted outright
 * (see pruneUnusedTags) rather than left to accumulate in the workspace.
 */
export async function setItemTags(db: Database, itemId: string, tagNames: string[]): Promise<void> {
  const normalizedNames = normalizeTagNames(tagNames);

  const previousTagIds = await db.transaction(async (tx) => {
    const previous = await tx
      .select({ tagId: itemTags.tagId })
      .from(itemTags)
      .where(eq(itemTags.itemId, itemId));
    await tx.delete(itemTags).where(eq(itemTags.itemId, itemId));

    if (normalizedNames.length > 0) {
      const tagRows = await Promise.all(normalizedNames.map((name) => findOrCreateTag(tx, name)));
      await tx.insert(itemTags).values(tagRows.map((tag) => ({ itemId, tagId: tag.id })));
    }

    return previous.map((row) => row.tagId);
  });

  await pruneUnusedTags(db, previousTagIds);
}

/**
 * Deletes any of the given tag ids that neither an item nor a flashcard
 * references anymore. Meant to run after detaching tags from an item/
 * flashcard (an edit that drops a tag) or deleting one outright: the join
 * row disappears via that table's `ON DELETE CASCADE` either way, but the
 * `tags` row itself doesn't, so an unused tag would otherwise linger — and
 * keep showing up in autocomplete — forever. Safe to call with tag ids that
 * are still in use (by either content type); those are just left alone.
 */
export async function pruneUnusedTags(db: Database, tagIds: string[]): Promise<void> {
  const uniqueIds = [...new Set(tagIds)];
  if (uniqueIds.length === 0) return;

  const [stillUsedByItems, stillUsedByFlashcards] = await Promise.all([
    db.select({ tagId: itemTags.tagId }).from(itemTags).where(inArray(itemTags.tagId, uniqueIds)),
    db.select({ tagId: flashcardTags.tagId }).from(flashcardTags).where(inArray(flashcardTags.tagId, uniqueIds)),
  ]);
  const stillUsedIds = new Set([
    ...stillUsedByItems.map((row) => row.tagId),
    ...stillUsedByFlashcards.map((row) => row.tagId),
  ]);
  const unusedIds = uniqueIds.filter((tagId) => !stillUsedIds.has(tagId));
  if (unusedIds.length === 0) return;

  try {
    await db.delete(tags).where(inArray(tags.id, unusedIds));
    for (const tagId of unusedIds) {
      logMutationSuccess(logger, "Tag deleted", { entity: ENTITY, entityId: tagId });
    }
  } catch (error) {
    for (const tagId of unusedIds) {
      logMutationFailure(logger, "Tag deletion failed", { entity: ENTITY, entityId: tagId }, error);
    }
    throw error;
  }
}

/** The tag names currently attached to a single item, alphabetically. */
export async function getItemTagNames(db: Database, itemId: string): Promise<string[]> {
  const tagsByItem = await getTagNamesForItems(db, [itemId]);
  return tagsByItem.get(itemId) ?? [];
}

/**
 * Bulk form of getItemTagNames — one query for a whole page of items rather
 * than one query per item, for the shared item list.
 */
export async function getTagNamesForItems(
  db: Database,
  itemIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (itemIds.length === 0) return result;

  const rows = await db
    .select({ itemId: itemTags.itemId, name: tags.name })
    .from(itemTags)
    .innerJoin(tags, eq(itemTags.tagId, tags.id))
    .where(inArray(itemTags.itemId, itemIds))
    .orderBy(asc(tags.name));

  for (const row of rows) {
    const existing = result.get(row.itemId);
    if (existing) {
      existing.push(row.name);
    } else {
      result.set(row.itemId, [row.name]);
    }
  }

  return result;
}

/**
 * Replaces a flashcard's full set of tags with `tagNames` — same
 * whole-value-replacement convention as setItemTags, reusing the same
 * normalize/find-or-create/prune machinery against the shared `tags` table.
 */
export async function setFlashcardTags(db: Database, flashcardId: string, tagNames: string[]): Promise<void> {
  const normalizedNames = normalizeTagNames(tagNames);

  const previousTagIds = await db.transaction(async (tx) => {
    const previous = await tx
      .select({ tagId: flashcardTags.tagId })
      .from(flashcardTags)
      .where(eq(flashcardTags.flashcardId, flashcardId));
    await tx.delete(flashcardTags).where(eq(flashcardTags.flashcardId, flashcardId));

    if (normalizedNames.length > 0) {
      const tagRows = await Promise.all(normalizedNames.map((name) => findOrCreateTag(tx, name)));
      await tx.insert(flashcardTags).values(tagRows.map((tag) => ({ flashcardId, tagId: tag.id })));
    }

    return previous.map((row) => row.tagId);
  });

  await pruneUnusedTags(db, previousTagIds);
}

/** The tag names currently attached to a single flashcard, alphabetically. */
export async function getFlashcardTagNames(db: Database, flashcardId: string): Promise<string[]> {
  const tagsByFlashcard = await getTagNamesForFlashcards(db, [flashcardId]);
  return tagsByFlashcard.get(flashcardId) ?? [];
}

/**
 * Bulk form of getFlashcardTagNames — one query for a whole page of
 * flashcards rather than one query per flashcard, mirroring
 * getTagNamesForItems.
 */
export async function getTagNamesForFlashcards(
  db: Database,
  flashcardIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (flashcardIds.length === 0) return result;

  const rows = await db
    .select({ flashcardId: flashcardTags.flashcardId, name: tags.name })
    .from(flashcardTags)
    .innerJoin(tags, eq(flashcardTags.tagId, tags.id))
    .where(inArray(flashcardTags.flashcardId, flashcardIds))
    .orderBy(asc(tags.name));

  for (const row of rows) {
    const existing = result.get(row.flashcardId);
    if (existing) {
      existing.push(row.name);
    } else {
      result.set(row.flashcardId, [row.name]);
    }
  }

  return result;
}
