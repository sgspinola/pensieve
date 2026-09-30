"use client";

import { ImportFlow } from "./ImportFlow";
import type { ImportableItemKind } from "@/services/items/items";

/** Links/Tools/Articles -> Import (ticket 07), a thin usage of the generic ImportFlow. */
export function ItemImportFlow({ kind, enabled }: { kind: ImportableItemKind; enabled: boolean }) {
  return (
    <ImportFlow
      previewUrl="/api/items/import/preview"
      commitUrl="/api/items/import"
      extraBody={{ kind }}
      describeResult={(result) => `Done. Created ${result.created}.`}
      enabled={enabled}
    />
  );
}
