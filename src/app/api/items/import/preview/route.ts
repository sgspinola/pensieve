import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { itemImportBodySchema } from "@/lib/import-schemas";
import { parseOrThrow } from "@/lib/validation";
import { parseItemsImportFile } from "@/services/items/items-import";

/**
 * Ticket 07: parses (and validates, all-or-nothing) a candidate item
 * import file of the given kind without writing anything, so the modal can
 * show "N entries parsed" before the member commits. Reuses
 * parseItemsImportFile directly so "what the preview counts" and "what the
 * commit route actually imports" can never drift apart.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const { file } = parseOrThrow(itemImportBodySchema, body);

  await getCurrentUser();
  const entries = parseItemsImportFile(file);
  return NextResponse.json({ count: entries.length });
});
