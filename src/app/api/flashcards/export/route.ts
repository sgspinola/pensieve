import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { withErrorHandling } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { exportFlashcardsFile } from "@/services/flashcards/flashcards-export";

export const EXPORT_FILENAME = "flashcards-export.md";

/** The response headers that make this a browser download of the export file, not an inline response. */
export function buildExportHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Disposition": `attachment; filename="${EXPORT_FILENAME}"`,
  };
}

/**
 * Any authenticated member can export every flashcard in the workspace
 * (ticket 05) — same "no admin gating" rule the Import/Export menu entry
 * itself follows. Thin: all the actual formatting lives in
 * exportFlashcardsFile.
 */
export const GET = withErrorHandling(async () => {
  await getCurrentUser();
  const file = await exportFlashcardsFile(getDb());
  return new NextResponse(file, { headers: buildExportHeaders() });
});
