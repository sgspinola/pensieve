import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { withErrorHandling } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { exportKindParamSchema } from "@/lib/query-schemas";
import { parseOrThrow } from "@/lib/validation";
import { exportItemsFile } from "@/services/items/items-export";

/**
 * Any authenticated member can export every item of a given kind
 * (ticket 07) — same "no admin gating" rule the Flashcards export follows.
 * Thin: all the actual formatting lives in exportItemsFile. `?kind=` is
 * validated by `exportKindParamSchema` (src/lib/query-schemas.ts, ticket
 * 19) via `parseOrThrow`, replacing the removed `parseKindParam` — a
 * missing or invalid kind is now a `ValidationError`-backed 400 through the
 * same envelope every other query/body schema in this codebase uses.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const kind = parseOrThrow(exportKindParamSchema, searchParams.get("kind"));

  await getCurrentUser();
  const file = await exportItemsFile(getDb(), kind);
  return new NextResponse(file, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind}s-export.md"`,
    },
  });
});
