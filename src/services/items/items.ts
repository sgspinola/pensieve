import { and, count, desc, eq, ilike, inArray, or, type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { itemTags, items, tags, users } from "@/db/schema";
import { getLogger } from "@/lib/logging";
import { NotFoundError, UnauthorizedError, ValidationError } from "@/services/errors";
import type { SessionUser } from "@/services/auth/session";
import { createCursorPagination } from "@/services/cursor-pagination";
import { fetchUrlMetadata, type Fetcher, type ItemMetadata } from "@/services/items/metadata";
import { deleteArticleWithChildren, wouldCreateCycle } from "@/services/items/wiki";
import { changedFieldNames, logMutationFailure, logMutationSuccess } from "@/services/mutation-log";
import { getTagNamesForItems, normalizeTagName, pruneUnusedTags, setItemTags } from "@/services/tags/tags";
import type { CreatableItemKind, ImportableItemKind, LibraryItemKind } from "@/services/items/item-kinds";

export {
  CREATABLE_ITEM_KINDS,
  isCreatableItemKind,
  isImportableItemKind,
  LIBRARY_ITEM_KINDS,
  isLibraryItemKind,
} from "@/services/items/item-kinds";
export type { CreatableItemKind, ImportableItemKind, LibraryItemKind } from "@/services/items/item-kinds";

const logger = getLogger(["pensieve", "items"]);
const ENTITY = "items";

export type Item = typeof items.$inferSelect;

export interface ItemWithCreator extends Item {
  createdByName: string;
  tags: string[];
}

export interface CreateItemInput {
  creatorId: string;
  kind: CreatableItemKind;
  // Required for link/tool/article (the page fetched for metadata); wiki
  // pages have no source URL.
  url?: string;
  // Omit a field to have it prefilled from the page's metadata; pass an
  // explicit value to override/skip that prefill entirely. Not fetched for
  // pages — always taken as given. Unlike `description`, an explicit ""
  // (or a metadata fetch that finds nothing) is rejected rather than saved
  // — see the required-title check below (ticket 03).
  title?: string | null;
  description?: string | null;
  notes?: string | null;
  // Wiki page markdown body; unused for link/tool/article.
  content?: string | null;
  // Freeform tag names (issue 07) — normalized and reused by name rather
  // than duplicated (see src/services/tags/tags.ts). Omit for no tags.
  tags?: string[];
  // Wiki hierarchy parent (ticket 02): only valid for `kind: "page"`, must
  // reference an existing page. Omit for "no parent"/not applicable; pass
  // `null` explicitly for a top-level page.
  parentId?: string | null;
}

export interface CreateItemDeps {
  fetchMetadata?: (url: string, fetchImpl?: Fetcher) => Promise<ItemMetadata>;
}

/**
 * Shared existence+kind check for a proposed `parentId`: the referenced
 * item must exist and be a `kind: "page"` — used by both createItem and
 * updateItem so the rule can't drift between the two call sites.
 */
async function assertValidParent(db: Database, parentId: string): Promise<void> {
  const [parent] = await db.select().from(items).where(eq(items.id, parentId));
  if (!parent || parent.kind !== "page") {
    throw new ValidationError("parentId must reference an existing page");
  }
}

/**
 * Creates a link, tool, article, or wiki page item. For a link/tool/article,
 * when the caller omits `title`/`description`, the target URL is fetched
 * server-side and its Open Graph/`<title>`/meta-description tags are parsed
 * to prefill them; an explicitly-provided value (even an empty string)
 * always wins and skips the fetch for that field entirely. A failed or
 * metadata-less fetch never blocks creation — fetchUrlMetadata resolves to
 * nulls rather than throwing (see src/services/items/metadata.ts), so the
 * item is simply saved with whatever it got. A wiki page has no URL to
 * fetch, so it never triggers a metadata fetch — its `title`/`content` are
 * always taken as given.
 *
 * `title` is required for every kind (ticket 03): once metadata-fetch
 * prefill (if any) is resolved, a still-empty/null title — including from a
 * failed or metadata-less fetch — throws ValidationError rather than
 * silently saving a blank title.
 */
export async function createItem(
  db: Database,
  input: CreateItemInput,
  deps: CreateItemDeps = {},
): Promise<Item> {
  // Set once the insert succeeds, so a later failure (e.g. tag assignment)
  // still logs the id it created — a failure before the insert genuinely
  // has no id to log.
  let insertedId: string | undefined;
  try {
    const fetchMetadata = deps.fetchMetadata ?? fetchUrlMetadata;

    let title = input.title ?? null;
    let description = input.description ?? null;

    const needsTitle = input.title === undefined;
    const needsDescription = input.description === undefined;

    if (input.kind !== "page" && input.url && (needsTitle || needsDescription)) {
      const metadata = await fetchMetadata(input.url);
      if (needsTitle) title = metadata.title;
      if (needsDescription) description = metadata.description;
    }

    if (input.parentId !== undefined) {
      if (input.kind !== "page") {
        throw new ValidationError("parentId is only valid for pages");
      }
      if (input.parentId !== null) {
        await assertValidParent(db, input.parentId);
      }
    }

    // Ticket 03: title is required for every kind — including when a
    // link/tool/article's metadata fetch failed or found nothing, which used
    // to silently save a null title instead of rejecting the request.
    const finalTitle = (title ?? "").trim();
    if (!finalTitle) {
      throw new ValidationError("title is required");
    }

    const [row] = await db
      .insert(items)
      .values({
        kind: input.kind,
        url: input.url ?? null,
        title: finalTitle,
        description,
        content: input.content ?? null,
        notes: input.notes ?? null,
        createdBy: input.creatorId,
        parentId: input.parentId ?? null,
      })
      .returning();
    insertedId = row.id;

    if (input.tags !== undefined) {
      await setItemTags(db, row.id, input.tags);
    }

    logMutationSuccess(logger, "Item created", { entity: ENTITY, kind: input.kind, entityId: row.id });
    return row;
  } catch (error) {
    // `entityId` is only present once the insert above has actually
    // succeeded — a failure before that point has no row/id to log.
    logMutationFailure(logger, "Item creation failed", { entity: ENTITY, kind: input.kind, entityId: insertedId }, error);
    throw error;
  }
}

export interface ListItemsOptions {
  // Combined search box (issue 08): each whitespace-separated term must
  // match somewhere in the item's title, description, notes, or one of its
  // tag names — not necessarily the same field for every term — so a query
  // narrows (AND semantics) the way every other search box behaves.
  query?: string;
  // Kind-chip filtering (ticket 03): an item matches if its kind is any one
  // of the given kinds (OR semantics within the facet), mirroring `tags`.
  // ANDs with `tags`/`query` the same way those already AND with each other.
  // Omit or pass an empty array for no kind narrowing (all kinds).
  kinds?: CreatableItemKind[];
  // Tag-chip filtering (issue 04): an item matches if it carries at least one
  // tag whose name is in this list (OR semantics within the facet). ANDs
  // with `kinds`/`query` the same way those already AND with each other.
  // Omit or pass an empty array for no tag narrowing.
  tags?: string[];
  // Keyset pagination (ticket 02): when omitted, every matching item is
  // returned as a plain array in one page — the pre-pagination behavior,
  // still relied on by WikiLayout/WikiArticlePage (need the full item tree)
  // and exportItemsFile (needs every item for CSV/markdown export), so this
  // must stay the exact default. When given, at most `limit` items are
  // returned per call, wrapped in an `ItemsPage` (see the overloads below).
  limit?: number;
  // Opaque cursor from a previous call's `nextCursor`. Omit for the first
  // page.
  cursor?: string;
}

export interface ItemsPage {
  items: ItemWithCreator[];
  // Opaque cursor to pass as `cursor` to fetch the next page, or null when
  // this was the last page.
  nextCursor: string | null;
}

/**
 * Keyset pagination bound to items' (createdAt, id) — see
 * src/services/cursor-pagination.ts for the shared implementation
 * (identical to flashcards.ts's, differing only in which table it binds to).
 */
const itemCursorPagination = createCursorPagination(items.createdAt, items.id);

/** Escapes a raw search term for safe use inside a LIKE/ILIKE `%...%` pattern. */
function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * True when `term` appears in this item's title, description, notes, or the
 * name of any tag attached to it. The tag check is a correlated EXISTS
 * subquery rather than a JOIN so matching on N terms never multiplies the
 * result set into duplicate rows.
 */
function itemMatchesSearchTerm(term: string): SQL {
  const pattern = `%${escapeLikePattern(term)}%`;
  return or(
    ilike(items.title, pattern),
    ilike(items.description, pattern),
    ilike(items.notes, pattern),
    sql`exists (
      select 1 from ${itemTags}
      inner join ${tags} on ${tags.id} = ${itemTags.tagId}
      where ${itemTags.itemId} = ${items.id} and ${tags.name} ilike ${pattern}
    )`,
  )!;
}

/**
 * True when this item carries at least one tag whose name is in `tagNames`
 * — the same correlated EXISTS-subquery shape as itemMatchesSearchTerm, so
 * matching against N tags never multiplies the result set into duplicate
 * rows. `tagNames` is normalized the same way tag names are normalized at
 * write time (see normalizeTagName), so a differently-cased or
 * differently-spaced filter value still matches the stored row.
 */
function itemHasAnyTag(tagNames: string[]): SQL {
  const normalizedNames = tagNames.map(normalizeTagName);
  return sql`exists (
    select 1 from ${itemTags}
    inner join ${tags} on ${tags.id} = ${itemTags.tagId}
    where ${itemTags.itemId} = ${items.id} and ${inArray(tags.name, normalizedNames)}
  )`;
}

/**
 * Shared narrowing logic for both `listItems` and `countItems` — a combined
 * search query, a `kinds` filter (issue 08, ticket 03), and/or a `tags`
 * filter (issue 04), all composing with AND. Kept as its own helper so the
 * count query and the list query can never drift apart on what counts as a
 * match (ticket 02: the header count must reflect exactly the same filter
 * combination the list itself uses).
 */
function buildItemFilterConditions(options: { query?: string; kinds?: CreatableItemKind[]; tags?: string[] }): SQL[] {
  const conditions: SQL[] = [];
  if (options.kinds && options.kinds.length > 0) {
    conditions.push(inArray(items.kind, options.kinds));
  }
  for (const term of options.query?.trim().split(/\s+/).filter(Boolean) ?? []) {
    conditions.push(itemMatchesSearchTerm(term));
  }
  if (options.tags && options.tags.length > 0) {
    conditions.push(itemHasAnyTag(options.tags));
  }
  return conditions;
}

/**
 * The shared list view: every item in the workspace regardless of creator,
 * newest first (with an `id` tie-breaker for stable pagination — see
 * `itemCursorPagination`/src/services/cursor-pagination.ts), with each creator's display name resolved so the UI
 * never has to make a second round trip per row. Optionally narrowed by a
 * combined search query, a `kinds` filter, and/or a `tags` filter (all three
 * AND together — see `buildItemFilterConditions`), and/or keyset-paginated
 * via `limit`/`cursor` (ticket 02).
 *
 * Backward-compatible by construction (ticket 02): when `limit` is omitted,
 * every matching item is returned as a plain `ItemWithCreator[]` — the exact
 * pre-pagination shape and behavior — which is what WikiLayout,
 * WikiArticlePage, and exportItemsFile still depend on (they need the
 * complete result set, unpaginated). Only when a caller opts in with
 * `limit` does this return the paginated `ItemsPage` shape instead — see the
 * overloads below.
 */
export async function listItems(db: Database, options?: ListItemsOptions & { limit?: undefined }): Promise<ItemWithCreator[]>;
export async function listItems(db: Database, options: ListItemsOptions & { limit: number }): Promise<ItemsPage>;
export async function listItems(
  db: Database,
  options: ListItemsOptions = {},
): Promise<ItemWithCreator[] | ItemsPage> {
  const conditions = buildItemFilterConditions(options);
  if (options.cursor !== undefined) {
    conditions.push(itemCursorPagination.afterCursor(itemCursorPagination.decode(options.cursor)));
  }

  const query = db
    .select({
      id: items.id,
      kind: items.kind,
      url: items.url,
      title: items.title,
      description: items.description,
      content: items.content,
      notes: items.notes,
      parentId: items.parentId,
      createdBy: items.createdBy,
      createdByName: users.displayName,
      createdAt: items.createdAt,
      updatedAt: items.updatedAt,
    })
    .from(items)
    .innerJoin(users, eq(items.createdBy, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(itemCursorPagination.orderKey()), desc(items.id));

  const { limit } = options;
  // Fetch one extra row (when paginating) purely to tell "exactly `limit`
  // rows left" apart from "more remain" — sliced back off below.
  const rows = limit !== undefined ? await query.limit(limit + 1) : await query;
  const hasMore = limit !== undefined && rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const tagsByItem = await getTagNamesForItems(
    db,
    pageRows.map((row) => row.id),
  );
  const pageItems = pageRows.map((row) => ({ ...row, tags: tagsByItem.get(row.id) ?? [] }));

  if (limit === undefined) {
    return pageItems;
  }

  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow
      ? itemCursorPagination.encode({ createdAt: lastRow.createdAt.toISOString(), id: lastRow.id })
      : null;
  return { items: pageItems, nextCursor };
}

export interface CountItemsOptions {
  query?: string;
  kinds?: CreatableItemKind[];
  tags?: string[];
}

/**
 * The true total of items matching the same `query`/`kinds`/`tags` filters
 * `listItems` accepts (ticket 02) — a `COUNT(*)` rather than the length of
 * whatever page happens to be loaded, so a header count stays correct
 * without ever needing every page fetched. Its own function rather than
 * folded into `listItems`'s return shape: the count query has no
 * `ORDER BY`/`LIMIT`, and the UI only needs to run it once per filter
 * combination, not on every page fetch.
 */
export async function countItems(db: Database, options: CountItemsOptions = {}): Promise<number> {
  const conditions = buildItemFilterConditions(options);

  const [row] = await db
    .select({ count: count() })
    .from(items)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  return row?.count ?? 0;
}

export async function getItem(db: Database, id: string): Promise<Item> {
  const [row] = await db.select().from(items).where(eq(items.id, id));
  if (!row) {
    throw new NotFoundError("Item not found");
  }
  return row;
}

/**
 * The single permission rule for item mutation, kept as its own pure
 * function so update/delete (and any future caller) share exactly one
 * implementation: the admin may modify anything; a member may modify only
 * what they created.
 */
export function canModifyItem(actor: SessionUser, item: { createdBy: string }): boolean {
  return actor.role === "admin" || actor.id === item.createdBy;
}

function assertCanModify(actor: SessionUser, item: Item): void {
  if (!canModifyItem(actor, item)) {
    throw new UnauthorizedError("You do not have permission to modify this item");
  }
}

export interface UpdateItemInput {
  url?: string | null;
  // Not nullable (ticket 03: title is NOT NULL at the DB layer) — omit to
  // leave the current title unchanged, same convention as every other field.
  title?: string;
  description?: string | null;
  notes?: string | null;
  // Overwrites a wiki page's markdown body in place — the prior value is
  // not retained anywhere (no history/snapshot table).
  content?: string | null;
  // When provided, replaces the item's full tag set (omit to leave the
  // item's current tags untouched — same convention as every other field).
  tags?: string[];
  // Wiki hierarchy parent (ticket 02): only valid for `kind: "page"`, must
  // reference an existing page and must not introduce a cycle. Omit to
  // leave unchanged; pass `null` to clear (make top-level).
  parentId?: string | null;
}

export async function updateItem(
  db: Database,
  actor: SessionUser,
  id: string,
  updates: UpdateItemInput,
): Promise<Item> {
  // Unknown (and so omitted from the failure log) if getItem itself throws.
  let kind: CreatableItemKind | undefined;
  try {
    const item = await getItem(db, id);
    kind = item.kind;
    // Kind-aware permission check: any authenticated actor may edit a
    // page's fields; link/tool/article keep the original creator-or-admin rule.
    if (item.kind !== "page") {
      assertCanModify(actor, item);
    }

    const { tags, ...columnUpdates } = updates;

    // Ticket 03: title is required for every kind — an update can't blank it
    // out any more than createItem can create an item with one, even though
    // the DB's NOT NULL constraint alone wouldn't catch an explicit "".
    if ("title" in columnUpdates && !columnUpdates.title?.trim()) {
      throw new ValidationError("title is required");
    }

    if ("parentId" in columnUpdates) {
      if (item.kind !== "page") {
        throw new ValidationError("parentId is only valid for pages");
      }
      const newParentId = columnUpdates.parentId;
      if (newParentId !== null && newParentId !== undefined) {
        await assertValidParent(db, newParentId);
        if (newParentId !== item.parentId) {
          const articleRows = await db
            .select({ id: items.id, parentId: items.parentId, title: items.title })
            .from(items)
            .where(eq(items.kind, "page"));
          const articles = articleRows.map((row) => ({ ...row, title: row.title ?? "" }));
          if (wouldCreateCycle(articles, id, newParentId)) {
            throw new ValidationError("This would create a cycle in the article hierarchy");
          }
        }
      }
    }

    // Ticket 09: reuses the pre-update row already fetched above (via
    // getItem) — field *names* only, never old/new values.
    const changedFields = changedFieldNames(item, columnUpdates);

    const [row] = await db
      .update(items)
      .set({ ...columnUpdates, updatedAt: new Date() })
      .where(eq(items.id, id))
      .returning();

    if (tags !== undefined) {
      await setItemTags(db, id, tags);
    }

    logMutationSuccess(logger, "Item updated", { entity: ENTITY, kind, entityId: id, changedFields });
    return row;
  } catch (error) {
    logMutationFailure(logger, "Item update failed", { entity: ENTITY, kind, entityId: id }, error);
    throw error;
  }
}

export async function deleteItem(
  db: Database,
  actor: SessionUser,
  id: string,
  options: { cascade?: boolean } = {},
): Promise<void> {
  // Unknown (and so omitted from the failure log) if getItem itself throws.
  let kind: CreatableItemKind | undefined;
  try {
    const item = await getItem(db, id);
    kind = item.kind;
    // Pages delegate the entire operation — including their own permission
    // check (promote is creator-or-admin, cascade is admin-only) and its own
    // mutation logging, one line per row it actually touches (ticket 25) —
    // to deleteArticleWithChildren (ticket 04). link/tool/article ignore
    // `cascade` and keep today's exact single-item delete behavior.
    if (item.kind === "page") {
      await deleteArticleWithChildren(db, actor, id, { cascade: options.cascade ?? false });
      return;
    }

    assertCanModify(actor, item);
    const itemTagRows = await db.select({ tagId: itemTags.tagId }).from(itemTags).where(eq(itemTags.itemId, id));
    await db.delete(items).where(eq(items.id, id));
    await pruneUnusedTags(
      db,
      itemTagRows.map((row) => row.tagId),
    );
    logMutationSuccess(logger, "Item deleted", { entity: ENTITY, kind, entityId: id });
  } catch (error) {
    logMutationFailure(logger, "Item deletion failed", { entity: ENTITY, kind, entityId: id }, error);
    throw error;
  }
}
