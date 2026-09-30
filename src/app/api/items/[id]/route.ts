import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { withErrorHandling } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { cascadeQuerySchema } from "@/lib/query-schemas";
import { idParamSchema, pickProvidedFields } from "@/lib/request-fields";
import { parseOrThrow } from "@/lib/validation";
import { deleteItem, updateItem, type UpdateItemInput } from "@/services/items/items";
import { updateItemBodySchema } from "./schema";

const UPDATABLE_FIELDS = [
  "url",
  "title",
  "description",
  "notes",
  "content",
  "tags",
  "parentId",
] as const;

/**
 * The service layer (updateItem) is the sole enforcer of "creator or admin
 * only" — this route just parses the request and forwards the caller. For a
 * wiki article, `content` overwrites the markdown body in place (updateItem
 * keeps no history/snapshot of what it replaces).
 */
export const PATCH = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await params;
    const id = parseOrThrow(idParamSchema, rawId);
    const body = await request.json().catch(() => null);
    const parsedBody = parseOrThrow(updateItemBodySchema, body);

    const updates = pickProvidedFields(parsedBody, UPDATABLE_FIELDS) as UpdateItemInput;

    const user = await getCurrentUser();
    const item = await updateItem(getDb(), user, id, updates);
    return NextResponse.json({ item });
  },
);

/**
 * `?cascade=` (ticket 19) gates whether deleting a wiki article also
 * deletes its children (see `deleteItem`'s own `options.cascade`) —
 * validated via `cascadeQuerySchema` (src/lib/query-schemas.ts) run through
 * `parseOrThrow`, replacing the previous `searchParams.get("cascade") ===
 * "true"` check, which silently treated any non-`"true"` value as `false`
 * instead of rejecting a malformed one.
 */
export const DELETE = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await params;
    const id = parseOrThrow(idParamSchema, rawId);
    const { searchParams } = new URL(request.url);
    const cascade = parseOrThrow(cascadeQuerySchema, searchParams.get("cascade"));

    const user = await getCurrentUser();
    await deleteItem(getDb(), user, id, { cascade });
    return new NextResponse(null, { status: 204 });
  },
);
