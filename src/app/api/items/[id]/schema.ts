import { z } from "zod";
import { isStringArray } from "@/lib/request-fields";
import { rejectedField, stringOrNull } from "../zod-helpers";

/**
 * Zod schema for `PATCH /api/items/[id]`'s update body (ticket 17) — same
 * updatable fields as `UpdateItemInput` (src/services/items/items.ts), all
 * optional (omitting a key means "leave unchanged," same convention the
 * service layer already uses), used with `parseOrThrow` (ticket 13) in place
 * of this route's former hand-rolled `tags`/`parentId` checks. `kind` is
 * immutable (ticket 05's original rule): `rejectedField` (../zod-helpers.ts)
 * makes *presence* of the key — any value, even the item's current kind —
 * always fail, giving a clean field-level issue instead of silently
 * dropping the key.
 *
 * Unlike the create schema (./route.ts's sibling `../schema.ts`), there is
 * no kind-conditional requiredness here: an update never has to supply
 * title/content/url together, it only validates whatever the caller
 * actually sent. `title` mirrors `UpdateItemInput`'s own non-nullable
 * `title?: string` (blanking it out is rejected downstream, by
 * `updateItem` itself); every other field mirrors its nullable
 * `?: string | null`.
 */

export const updateItemBodySchema = z.object({
  kind: rejectedField("kind cannot be changed").optional(),
  url: stringOrNull("url").optional(),
  title: z.custom<string>((value) => typeof value === "string", { message: "title must be a string" }).optional(),
  description: stringOrNull("description").optional(),
  notes: stringOrNull("notes").optional(),
  content: stringOrNull("content").optional(),
  tags: z.custom<string[]>(isStringArray, { message: "tags must be an array of strings" }).optional(),
  parentId: stringOrNull("parentId").optional(),
});

export type UpdateItemBody = z.infer<typeof updateItemBodySchema>;
