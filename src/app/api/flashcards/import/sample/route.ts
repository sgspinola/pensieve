import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api-errors";
import { getCurrentUser } from "@/lib/current-user";
import { buildFlashcardImportSample } from "@/services/flashcards/flashcards-import";

const SAMPLE_FILENAME = "flashcards-import-sample.md";

/** Downloads the two-entry sample file the modal's Import step links to (ticket 06). */
export const GET = withErrorHandling(async () => {
  await getCurrentUser();
  return new NextResponse(buildFlashcardImportSample(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${SAMPLE_FILENAME}"`,
    },
  });
});
