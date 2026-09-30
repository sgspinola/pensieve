import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { withErrorHandling } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { importFileBodySchema } from "@/lib/import-schemas";
import { parseOrThrow } from "@/lib/validation";
import { importFlashcardsFile } from "@/services/flashcards/flashcards-import";

/**
 * Ticket 06: commits a previously-previewed import file. Thin — all the
 * parsing/validation and the upsert-by-frontHash logic live in
 * importFlashcardsFile, which is itself all-or-nothing (nothing is written
 * if any entry fails to parse or validate).
 */
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const { file } = parseOrThrow(importFileBodySchema, body);

  const user = await getCurrentUser();
  const result = await importFlashcardsFile(getDb(), file, user.id);
  return NextResponse.json(result);
});
