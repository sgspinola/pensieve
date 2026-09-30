# 19: List/query-string validation — pagination, filters, cascade

**What to build:** Zod schemas for the query-string parameters `limit`, `cursor`, `query`, `kind`, `tags` on `GET /api/items` and `GET /api/flashcards`; the `kind` param on `GET /api/items/export`; and the `cascade` param on the `[id]` DELETE routes for both items and flashcards. Replaces the current ad hoc clamping/parsing logic (`parseLimitParam`, `parseKindParam`, manual `searchParams.get`/`getAll` handling) with explicit, fail-closed schemas.

**Blocked by:** 13 (Zod-to-ValidationError bridge)

**Status:** done

**Completed:** on `feat/19-list-query-param-validation`

**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/21

- [x] Shared pagination/limit query-param Zod schema factored into a shared module (first genuine duplication point: both items and flashcards list routes use it) — `limitQuerySchema(defaultValue, max)` in the new `src/lib/query-schemas.ts`
- [x] Shared tag-array query-param Zod schema factored into a shared module (same duplication point) — `tagsQuerySchema`, same module; also added `queryParamSchema`/`cursorParamSchema` for the "what to build" line's remaining named params (`query`, `cursor`), shared between `GET /api/items` and `GET /api/flashcards` where both apply
- [x] `kind` schema shared between `GET /api/items` and `GET /api/items/export` — the two take different shapes (repeatable filter incl. `"page"` vs. single required value excl. `"page"`), so this is two schemas (`itemKindFilterSchema`, `exportKindParamSchema`) sharing `items.ts`'s `isCreatableItemKind`/`isImportableItemKind` guards rather than one forced-common schema
- [x] `cascade` schema applied to the DELETE handler on `/api/items/[id]`. **Not** wired into `/api/flashcards/[id]`: `deleteFlashcard` takes no `cascade`/options argument at all (flashcards have no parent/child relationship to cascade through), and that DELETE handler never read `searchParams` before this ticket either — there is nothing for a `cascade` schema to gate there. Documented in a route-level code comment (`src/app/api/flashcards/[id]/route.ts`) and in `docs/flows/flashcard-lifecycle.md`.
- [x] Existing ad hoc clamping (e.g. silently clamping an out-of-range `limit` instead of rejecting it) replaced with strict fail-closed rejection, consistent with this effort's validation philosophy
- [x] TypeScript types for parsed query params inferred via `z.infer` (`LimitQuery`, `TagsQuery`, `ItemKindFilter`, `ExportKindParam`, `CascadeQuery`, `QueryParam`, `CursorParam`)
- [x] Vitest: valid case and each distinct invalid case (non-numeric `limit`, out-of-range `limit`, invalid `kind`, malformed `cascade`) asserted against the resulting `issues`, for each affected route (`src/lib/query-schemas.test.ts` for the schemas themselves; route-level coverage in `src/app/api/items/route.test.ts`, `src/app/api/flashcards/route.test.ts`, `src/app/api/items/export/route.test.ts`, `src/app/api/items/[id]/route.test.ts`)
