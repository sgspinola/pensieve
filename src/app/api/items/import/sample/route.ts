import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { isImportableItemKind } from "@/services/items/items";
import { buildItemImportSample } from "@/services/items/items-import";

/** Downloads the two-entry sample file for the given kind (ticket 07). */
export const GET = withErrorHandling(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind");
  if (!isImportableItemKind(kind)) {
    return NextResponse.json({ error: 'kind must be "link", "tool", or "article"' }, { status: 400 });
  }

  await getCurrentUser();
  return new NextResponse(buildItemImportSample(kind), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind}s-import-sample.md"`,
    },
  });
});
