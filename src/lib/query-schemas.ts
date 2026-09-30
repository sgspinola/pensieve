import { z } from "zod";
import {
  isCreatableItemKind,
  isImportableItemKind,
  type CreatableItemKind,
  type ImportableItemKind,
} from "@/services/items/items";

/**
 * Zod schemas for query-string parameters (ticket 19) — shared across
 * `GET /api/items`, `GET /api/flashcards`, `GET /api/items/export`, and the
 * DELETE handlers on `/api/items/[id]` and `/api/flashcards/[id]`. Used with
 * `parseOrThrow` (src/lib/validation.ts, ticket 13), the same bridge every
 * request-body schema in this codebase already runs through, so a malformed
 * query param now throws a `ValidationError` (clean 400 + field-level
 * issues) instead of being silently clamped or filtered the way the ad hoc
 * `parseLimitParam`/`parseKindParam`/`.filter(isCreatableItemKind)` logic
 * this replaces used to behave. Follows the same colocated-helpers
 * precedent as `src/lib/import-schemas.ts` (ticket 20) and
 * `src/app/api/items/zod-helpers.ts` (ticket 17): one shared module for the
 * genuine duplication points, rather than each route inlining its own copy.
 */

/**
 * `?limit=` as a page size — shared by `GET /api/items` and
 * `GET /api/flashcards`, which previously each carried their own identical
 * `parseLimitParam`. Strict fail-closed rejection in place of that
 * function's silent clamp-to-default: a non-integer value is rejected with
 * one message, an out-of-range value (outside `1..max`) with another.
 * Absent (`null`) still resolves to `defaultValue` — that half of the old
 * behavior ("no `?limit=` means use my page size") is preserved unchanged;
 * only an explicitly-sent bad value now fails the request instead of being
 * silently swapped for the default. `defaultValue`/`max` let each route
 * supply its own page size and upper bound (both currently `30`/`100` for
 * items and flashcards, but kept as parameters rather than hardcoded so the
 * two can diverge without forking this schema).
 */
export function limitQuerySchema(defaultValue: number, max: number) {
  return z
    .string()
    .nullable()
    .transform((raw, ctx) => {
      if (raw === null) return defaultValue;
      if (!/^\d+$/.test(raw)) {
        ctx.addIssue({ code: "custom", message: "limit must be a positive integer" });
        return z.NEVER;
      }
      const parsed = Number(raw);
      if (parsed < 1 || parsed > max) {
        ctx.addIssue({ code: "custom", message: `limit must be between 1 and ${max}` });
        return z.NEVER;
      }
      return parsed;
    });
}

export type LimitQuery = z.infer<ReturnType<typeof limitQuerySchema>>;

/**
 * `?tags=` (repeatable, read via `searchParams.getAll("tags")`) as a plain
 * string array — shared by `GET /api/items` and `GET /api/flashcards`,
 * ticket 19's explicit "first genuine duplication point" callout.
 * `getAll` already only ever returns strings, so this never actually
 * rejects anything today; it exists so both routes share one schema instead
 * of each inlining its own `z.array(z.string())`, and so a future per-tag
 * constraint (e.g. rejecting a blank tag) has one place to land instead of
 * two.
 */
export const tagsQuerySchema = z.array(z.string());

export type TagsQuery = z.infer<typeof tagsQuerySchema>;

/**
 * `?kind=` (repeatable, OR-semantics filter) on `GET /api/items` — every
 * `CreatableItemKind`, including the wiki-only `"page"` (`?kind=page` is
 * `/wiki`'s own plumbing — see route.ts's docstring). Previously
 * `.filter(isCreatableItemKind)` silently dropped an invalid entry out of
 * the filter set instead of rejecting the request; this is now fail-closed,
 * consistent with this ticket's validation philosophy — an invalid
 * `?kind=` is a caller bug worth a 400, not a silently-narrower filter.
 *
 * Not the same shape as `exportKindParamSchema` below (repeatable vs.
 * single value, and `"page"` is valid here but not there), so it's its own
 * schema rather than a forced shared one — but both share `items.ts`'s
 * kind guards (`isCreatableItemKind`/`isImportableItemKind`), so the two
 * can never drift on what counts as a valid kind.
 */
export const itemKindFilterSchema = z.array(
  z.custom<CreatableItemKind>(isCreatableItemKind, {
    message: 'kind must be "link", "tool", "article", or "page"',
  }),
);

export type ItemKindFilter = z.infer<typeof itemKindFilterSchema>;

/**
 * `?kind=` as `GET /api/items/export`'s single required kind — an
 * `ImportableItemKind` (every `CreatableItemKind` except `"page"`; wiki
 * pages aren't exported through this route). Replaces the removed
 * `parseKindParam`, which returned `null` for a missing/invalid kind and
 * left the route to build its own ad hoc 400 — this now throws the same
 * `ValidationError`-backed 400 every other query/body schema in this
 * codebase does, covering both "missing" (`null`) and "invalid" in one
 * check.
 */
export const exportKindParamSchema = z
  .string()
  .nullable()
  .transform((raw, ctx): ImportableItemKind => {
    if (!isImportableItemKind(raw)) {
      ctx.addIssue({ code: "custom", message: 'kind must be "link", "tool", or "article"' });
      return z.NEVER;
    }
    return raw;
  });

export type ExportKindParam = z.infer<typeof exportKindParamSchema>;

/**
 * `?cascade=` on `DELETE /api/items/[id]` — the only DELETE handler this
 * ticket wires it into; see `src/app/api/flashcards/[id]/route.ts`'s own
 * comment on why its DELETE does *not* use this (`deleteFlashcard` has no
 * cascade concept at all). Previously
 * `searchParams.get("cascade") === "true"` silently treated *any*
 * non-`"true"` value (a typo, `"1"`, `"TRUE"`) as `false`; this rejects
 * anything other than the two spellings a well-formed request sends —
 * `"true"`/`"false"` — or absence, which still defaults to `false` exactly
 * as before.
 */
export const cascadeQuerySchema = z
  .string()
  .nullable()
  .transform((raw, ctx) => {
    if (raw === null) return false;
    if (raw === "true") return true;
    if (raw === "false") return false;
    ctx.addIssue({ code: "custom", message: 'cascade must be "true" or "false"' });
    return z.NEVER;
  });

export type CascadeQuery = z.infer<typeof cascadeQuerySchema>;

/**
 * `?query=` — `GET /api/items`'s free-text search term, forwarded as-is to
 * `listItems`/`countItems`'s `query` filter. Any string (or absence) is
 * already valid input there — there's no format to reject — so, like
 * `tagsQuerySchema`, this never actually rejects anything today. It exists
 * because the ticket's own "what to build" line names `query` explicitly
 * alongside `limit`/`cursor`/`kind`/`tags`, and gives it one shared place to
 * live (`null` -> `undefined`) instead of `GET /api/items` inlining
 * `searchParams.get("query") ?? undefined` directly.
 */
export const queryParamSchema = z
  .string()
  .nullable()
  .transform((raw) => raw ?? undefined);

export type QueryParam = z.infer<typeof queryParamSchema>;

/**
 * `?cursor=` — the opaque keyset-pagination cursor `GET /api/items` and
 * `GET /api/flashcards` both accept (produced by
 * `src/services/cursor-pagination.ts`'s `encode`). Any string is
 * syntactically valid input at this layer; a *malformed* cursor's actual
 * rejection already happens downstream, at decode time
 * (`createCursorPagination`'s `decode`, which throws a `ValidationError` —
 * predates this ticket). This schema exists at the query-param layer purely
 * so `cursor` gets the same "one shared place to live" treatment as
 * `query` above, per the ticket's "what to build" line — it does not
 * duplicate or short-circuit the decode-time check.
 */
export const cursorParamSchema = z
  .string()
  .nullable()
  .transform((raw) => raw ?? undefined);

export type CursorParam = z.infer<typeof cursorParamSchema>;
