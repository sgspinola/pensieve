import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { parseOrThrow } from "@/lib/validation";
import { fetchUrlMetadata } from "@/services/items/metadata";
import { metadataBodySchema } from "./schema";

/**
 * Metadata preview: lets the add-item form show fetched title/description
 * for the user to review/override *before* the item is actually created.
 * Never fails the request on a bad/unreachable-but-well-formed URL —
 * fetchUrlMetadata resolves to nulls in that case, same as it does inside
 * createItem. A malformed URL (ticket 17) is now rejected before that fetch
 * is even attempted, via metadataBodySchema.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const { url } = parseOrThrow(metadataBodySchema, body);

  await getCurrentUser();
  const metadata = await fetchUrlMetadata(url);
  return NextResponse.json(metadata);
});
