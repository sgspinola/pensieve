import { z } from "zod";

/**
 * Validates a route's `id` dynamic segment as a UUID (ticket 15) — shared by
 * every GET/PATCH/DELETE handler on `/api/items/[id]` and
 * `/api/flashcards/[id]` via `parseOrThrow` (src/lib/validation.ts), so a
 * malformed id is rejected with a clean 400 before it reaches the database,
 * instead of surfacing as an unhandled Postgres error. This is the first
 * route-param schema, hence its own export here rather than duplicated
 * inline in each route file — the same shared-module pattern this file
 * already uses for request-body checks.
 */
export const idParamSchema = z.uuid("id must be a valid UUID");

/**
 * Picks only the keys actually present on a parsed JSON request body, so a
 * PATCH that omits a field never overwrites it with `undefined` — used
 * ahead of calling a service-layer update function, which treats "key
 * present" as "the caller wants to change this."
 */
export function pickProvidedFields<K extends string>(
  body: Record<string, unknown>,
  keys: readonly K[],
): Partial<Record<K, unknown>> {
  const result: Partial<Record<K, unknown>> = {};
  for (const key of keys) {
    if (key in body) {
      result[key] = body[key];
    }
  }
  return result;
}

/** True if `value` is an array of strings — used to validate a `tags` field. */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
