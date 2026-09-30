import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { withErrorHandling } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { itemImportBodySchema } from "@/lib/import-schemas";
import { parseOrThrow } from "@/lib/validation";
import { importItemsFile } from "@/services/items/items-import";

/**
 * Ticket 07: commits a previously-previewed item import file of the given
 * kind. Thin — all the parsing/validation and the always-insert-new-rows
 * logic live in importItemsFile, which is itself all-or-nothing.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const { kind, file } = parseOrThrow(itemImportBodySchema, body);

  const user = await getCurrentUser();
  const result = await importItemsFile(getDb(), file, kind, user.id);
  return NextResponse.json(result);
});
