import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { withErrorHandling } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import {
  cursorParamSchema,
  itemKindFilterSchema,
  limitQuerySchema,
  queryParamSchema,
  tagsQuerySchema,
} from "@/lib/query-schemas";
import { parseOrThrow } from "@/lib/validation";
import { countItems, createItem, listItems } from "@/services/items/items";
import { ITEMS_PAGE_SIZE } from "@/services/items/pagination";
import { createItemBodySchema } from "./schema";

// Upper bound on a client-requested `?limit=`, so an unreasonable value
// can't force one giant unpaginated query through this route. Mirrors
// src/app/api/flashcards/route.ts's MAX_PAGE_SIZE.
export const MAX_PAGE_SIZE = 100;

/**
 * Any authenticated user can read the fully shared item list, optionally
 * narrowed by a combined search query (`?query=`), a repeatable `kind`
 * filter (`?kind=link&kind=tool`, OR semantics), and/or a repeatable `tags`
 * filter (`?tags=a&tags=b`, OR semantics, same as `GET /api/flashcards`) —
 * the single search surface for the app (issue 08). `tags` exists on this
 * route specifically so `ItemsLibrary.tsx`'s infinite scroll can keep paging
 * through a tag-filtered result set (`buildLoadMoreQuery` already sends it);
 * without it, scrolling past the SSR first page would silently revert to
 * the unfiltered list.
 *
 * `kind=page` is deliberately still accepted here even though the library's
 * own flat list/search (`app/page.tsx`) never requests it: this endpoint is
 * also `/wiki`'s shared plumbing for fetching existing pages client-side —
 * `ParentArticleSelect.tsx` (the "Parent page" dropdown) and `ItemRow.tsx`'s
 * delete-a-page child-count check both call `fetch("/api/items?kind=page")`
 * directly. Excluding `page` here would silently break those.
 *
 * Pagination (keyset, ticket 02) is opt-in, mirroring `listItems`'s own
 * additive `limit`/`cursor`: only when the caller explicitly passes
 * `?limit=` or `?cursor=` does this route page (`?limit=` defaults to
 * ITEMS_PAGE_SIZE once either is present, `?cursor=` continues from a
 * previous response's `nextCursor`). With neither present, this keeps
 * returning every matching item in one response, exactly as before this
 * ticket — `ParentArticleSelect.tsx`'s parent-page dropdown and
 * `ItemRow.tsx`'s delete-a-page child-count check both call this endpoint
 * with no `?limit=` and need the complete `kind=page` set, not just the
 * first page, so this route can't default to paginating unconditionally the
 * way `GET /api/flashcards` does. `count` (the true `COUNT(*)`-backed total
 * for the active filter combination) is included either way, so the
 * items-library client can render an accurate header count without loading
 * every page.
 *
 * `query`/`kind`/`tags`/`limit`/`cursor` are all validated via shared Zod
 * schemas (src/lib/query-schemas.ts, ticket 19) run through `parseOrThrow`:
 * an invalid `?kind=`, or a non-numeric/out-of-range `?limit=`, now gets a
 * clean 400 instead of the previous silent `.filter(isCreatableItemKind)`/
 * clamp-to-default behavior. `query`/`tags`/`cursor` can't actually reject
 * anything (any string, or absence, is valid input to each), so those three
 * schemas exist purely so every query param this route reads has one
 * documented, shared place to live rather than an inline
 * `searchParams.get(...) ?? undefined`.
 */
export const GET = withErrorHandling(async (request: Request) => {
  await getCurrentUser();
  const { searchParams } = new URL(request.url);
  const query = parseOrThrow(queryParamSchema, searchParams.get("query"));
  const kinds = parseOrThrow(itemKindFilterSchema, searchParams.getAll("kind"));
  const tags = parseOrThrow(tagsQuerySchema, searchParams.getAll("tags"));
  const rawLimit = searchParams.get("limit");
  const rawCursor = searchParams.get("cursor");
  const isPaginated = rawLimit !== null || rawCursor !== null;

  const filters = { query, kinds: kinds.length > 0 ? kinds : undefined, tags: tags.length > 0 ? tags : undefined };
  const db = getDb();

  if (!isPaginated) {
    const [allItems, total] = await Promise.all([listItems(db, filters), countItems(db, filters)]);
    return NextResponse.json({ items: allItems, nextCursor: null, count: total });
  }

  const limit = parseOrThrow(limitQuerySchema(ITEMS_PAGE_SIZE, MAX_PAGE_SIZE), rawLimit);
  const cursor = parseOrThrow(cursorParamSchema, rawCursor);
  const [page, total] = await Promise.all([
    listItems(db, { ...filters, limit, cursor }),
    countItems(db, filters),
  ]);
  return NextResponse.json({ items: page.items, nextCursor: page.nextCursor, count: total });
});

/**
 * Any authenticated user can create a link, tool, article, or wiki page. A
 * link/tool/article needs a `url` (fetched server-side for metadata inside
 * createItem); a page has no URL and instead needs an authored `title` and
 * markdown `content` body up front. Shape/kind-conditional requiredness is
 * enforced by `createItemBodySchema` (ticket 17) via `parseOrThrow`.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const parsed = parseOrThrow(createItemBodySchema, body);
  const isPage = parsed.kind === "page";

  const user = await getCurrentUser();
  // The `as string` casts below are safe, not unchecked: createItemBodySchema
  // leaves `url`/`title`/`content` untyped at the field level specifically so
  // its `superRefine` can guarantee (not just narrow) that each is a
  // non-blank string whenever `isPage`/`!isPage` makes it required — see
  // ./schema.ts's superRefine. TypeScript has no way to encode that
  // kind-conditional guarantee in `parsed`'s inferred type, so the cast
  // documents it instead.
  const item = await createItem(getDb(), {
    creatorId: user.id,
    kind: parsed.kind,
    url: isPage ? undefined : (parsed.url as string).trim(),
    title: isPage ? (parsed.title as string).trim() : parsed.title,
    description: parsed.description,
    notes: parsed.notes,
    content: isPage ? (parsed.content as string).trim() : undefined,
    tags: parsed.tags,
    parentId: parsed.parentId,
  });
  return NextResponse.json({ item }, { status: 201 });
});
