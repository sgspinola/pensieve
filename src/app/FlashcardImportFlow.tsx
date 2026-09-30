"use client";

import { ImportFlow } from "./ImportFlow";

/** Flashcards -> Import (ticket 06), a thin usage of the generic ImportFlow (generalized in ticket 07). */
export function FlashcardImportFlow({ enabled }: { enabled: boolean }) {
  return (
    <ImportFlow
      previewUrl="/api/flashcards/import/preview"
      commitUrl="/api/flashcards/import"
      describeResult={(result) => `Done. Created ${result.created}, updated ${result.updated}.`}
      enabled={enabled}
    />
  );
}
