import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { withErrorHandling } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { idParamSchema, pickProvidedFields } from "@/lib/request-fields";
import { parseOrThrow } from "@/lib/validation";
import { deleteFlashcard, updateFlashcard, type UpdateFlashcardInput } from "@/services/flashcards/flashcards";
import { updateFlashcardBodySchema } from "../schema";

const UPDATABLE_FIELDS = ["front", "back", "source", "tags"] as const;

/**
 * The service layer (updateFlashcard) is deliberately open-edit — no
 * ownership/role check at all — so this route just parses the request and
 * forwards the caller as `actor`; no permission check is expected to fail
 * here, by design. Only `front`/`back`/`tags` are picked from the body, the
 * same way `/api/items/[id]`'s PATCH only forwards its own updatable set.
 */
export const PATCH = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await params;
    const id = parseOrThrow(idParamSchema, rawId);
    const rawBody = await request.json().catch(() => null);
    const body = parseOrThrow(updateFlashcardBodySchema, rawBody);

    const updates = pickProvidedFields(body, UPDATABLE_FIELDS) as UpdateFlashcardInput;

    const user = await getCurrentUser();
    const flashcard = await updateFlashcard(getDb(), user, id, updates);
    return NextResponse.json({ flashcard });
  },
);

/**
 * Ticket 19 added `?cascade=` validation (`cascadeQuerySchema`,
 * src/lib/query-schemas.ts) to `DELETE /api/items/[id]`, where it gates
 * `deleteItem`'s cascade-to-children behavior. It's deliberately *not*
 * wired in here: `deleteFlashcard` (src/services/flashcards/flashcards.ts)
 * takes no `cascade`/options argument at all — flashcards have no
 * parent/child relationship to cascade through — and this handler has
 * never read `searchParams`. Validating a `?cascade=` value that would be
 * silently ignored regardless adds a schema with no behavior behind it, so
 * there's nothing here for this ticket to validate.
 */
export const DELETE = withErrorHandling(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await params;
    const id = parseOrThrow(idParamSchema, rawId);

    const user = await getCurrentUser();
    await deleteFlashcard(getDb(), user, id);
    return new NextResponse(null, { status: 204 });
  },
);
