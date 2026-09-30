import { z } from "zod";

/**
 * Small Zod field-schema helpers shared by `POST /api/items`'s create body
 * schema (`./schema.ts`) and `PATCH /api/items/[id]`'s update body schema
 * (`./[id]/schema.ts`) — both ticket 17. Colocated here rather than
 * duplicated in each file, the same way `src/lib/import-schemas.ts` shares
 * `fileField` across the flashcards/items import routes.
 */

/** A field that accepts a string or `null`, rejecting anything else with `"<field> must be a string or null"`. */
export function stringOrNull(field: string) {
  return z.custom<string | null>((value) => value === null || typeof value === "string", {
    message: `${field} must be a string or null`,
  });
}

/**
 * A field that must never be present — used for `kind` on the update
 * schema, which is immutable once an item is created. Optional() lets an
 * absent key pass silently; *any* present value (even the item's current
 * kind) fails this custom check, giving a clean field-level issue instead
 * of the key being silently dropped.
 */
export function rejectedField(message: string) {
  return z.custom<never>(() => false, { message });
}
