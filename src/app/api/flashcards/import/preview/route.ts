import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { importFileBodySchema } from "@/lib/import-schemas";
import { parseOrThrow } from "@/lib/validation";
import { parseFlashcardsImportFile } from "@/services/flashcards/flashcards-import";

/**
 * Ticket 06: parses (and validates, all-or-nothing) a candidate import file
 * without writing anything, so the modal can show "N entries parsed" before
 * the member commits. Reuses parseFlashcardsImportFile directly rather than
 * a separate lighter-weight check, so "what the preview counts" and "what
 * the commit route actually imports" can never drift apart.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const { file } = parseOrThrow(importFileBodySchema, body);

  await getCurrentUser();
  const entries = parseFlashcardsImportFile(file);
  return NextResponse.json({ count: entries.length });
});
