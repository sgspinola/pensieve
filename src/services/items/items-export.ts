import matter from "gray-matter";
import type { Database } from "@/db/client";
import { type ImportableItemKind, listItems } from "@/services/items/items";

/**
 * Serializes every item of `kind` in the workspace (ticket 07) into the
 * same multi-entry frontmatter+body format flashcards-export.ts already
 * produces: `title`/`url`/`tags`/`description` as frontmatter (gray-matter
 * emits `description` as a YAML block scalar automatically once it
 * contains a newline — no extra handling needed), `notes` as the body.
 * `description` is omitted from the frontmatter object entirely when null
 * rather than round-tripping as a literal YAML `null`. Wiki pages
 * (`kind: "page"`) are out of scope — this only ever accepts a
 * link/tool/article kind (enforced by the caller, not re-validated here).
 */
export async function exportItemsFile(db: Database, kind: ImportableItemKind): Promise<string> {
  const items = await listItems(db, { kinds: [kind] });

  return items
    .map((item) => {
      const data: Record<string, unknown> = {
        title: item.title,
        url: item.url,
        tags: item.tags,
      };
      if (item.description) {
        data.description = item.description;
      }
      return matter.stringify(item.notes ?? "", data);
    })
    .join("");
}
