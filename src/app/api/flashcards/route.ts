import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { withErrorHandling } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { cursorParamSchema, limitQuerySchema, tagsQuerySchema } from "@/lib/query-schemas";
import { parseOrThrow } from "@/lib/validation";
import { countFlashcards, createFlashcard, listFlashcards, type FlashcardsPage } from "@/services/flashcards/flashcards";
import { FLASHCARDS_PAGE_SIZE } from "@/services/flashcards/pagination";
import { createFlashcardBodySchema } from "./schema";

// Upper bound on a client-requested `?limit=`, so an unreasonable value
// can't force one giant unpaginated query through this route.
export const MAX_PAGE_SIZE = 100;

/**
 * Folds the separately-fetched true count into the paginated page's
 * response body as `total`, leaving `flashcards`/`nextCursor` exactly as
 * `listFlashcards` returned them (ticket 01: an additive field, not a
 * replacement for the existing pagination contract — the infinite-scroll
 * client still pages via `nextCursor`, only the displayed total now comes
 * from this real `COUNT(*)` rather than accumulated page length). Exported
 * for direct unit testing (route.test.ts), same reasoning as
 * `parseLimitParam` above: Next.js route handlers aren't otherwise
 * unit-testable without a real request/DB, and this is the one piece of new
 * response-shaping logic in this route worth covering on its own.
 */
export function buildFlashcardsResponseBody(page: FlashcardsPage, total: number): FlashcardsPage & { total: number } {
  return { ...page, total };
}

/**
 * Any authenticated user can read the fully shared flashcard list,
 * optionally narrowed by a repeatable `tags` filter (`?tags=a&tags=b`, OR
 * semantics) — same pattern as `/api/items`'s repeatable `?kind=`. Always
 * paginated (keyset, ticket 04): `?limit=` (defaults to
 * FLASHCARDS_PAGE_SIZE) and `?cursor=` (from a previous response's
 * `nextCursor`) page through the list; a malformed `cursor` surfaces as a
 * 400 via listFlashcards's ValidationError. The response also carries
 * `total` (ticket 01): the true, tag-filter-scoped `COUNT(*)` of matching
 * flashcards, independent of `limit`/`cursor` — so the client can show a
 * correct, stable total instead of deriving one from however many rows it
 * has loaded so far.
 *
 * `tags`/`limit`/`cursor` are all validated via shared Zod schemas
 * (src/lib/query-schemas.ts, ticket 19) run through `parseOrThrow`: a
 * non-numeric or out-of-range `?limit=` is now a clean 400 instead of the
 * previous silent clamp-to-default. `tags`/`cursor` can't actually reject
 * anything (any string, or absence, is valid input to each — a malformed
 * `cursor` is still only caught downstream, at `listFlashcards`'s decode
 * step), but get a schema too so every param this route reads has one
 * documented, shared place to live.
 */
export const GET = withErrorHandling(async (request: Request) => {
  await getCurrentUser();
  const { searchParams } = new URL(request.url);
  const tags = parseOrThrow(tagsQuerySchema, searchParams.getAll("tags"));
  const limit = parseOrThrow(limitQuerySchema(FLASHCARDS_PAGE_SIZE, MAX_PAGE_SIZE), searchParams.get("limit"));
  const cursor = parseOrThrow(cursorParamSchema, searchParams.get("cursor"));
  const tagsFilter = tags.length > 0 ? tags : undefined;

  const db = getDb();
  const [page, total] = await Promise.all([
    listFlashcards(db, { tags: tagsFilter, limit, cursor }),
    countFlashcards(db, { tags: tagsFilter }),
  ]);
  return NextResponse.json(buildFlashcardsResponseBody(page, total));
});

/**
 * Any authenticated user can create a flashcard. Body shape (ticket 18) is
 * validated by createFlashcardBodySchema; "at least one tag" is a business
 * rule, not a shape rule, and stays enforced by createFlashcard itself (see
 * schema.ts's docstring).
 */
export const POST = withErrorHandling(async (request: Request) => {
  const rawBody = await request.json().catch(() => null);
  const body = parseOrThrow(createFlashcardBodySchema, rawBody);

  const user = await getCurrentUser();
  const flashcard = await createFlashcard(getDb(), {
    creatorId: user.id,
    front: body.front,
    back: body.back,
    source: body.source,
    tags: body.tags,
  });
  return NextResponse.json({ flashcard }, { status: 201 });
});
