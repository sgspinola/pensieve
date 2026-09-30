# 15: Item & flashcard `[id]` routes — UUID param validation

**What to build:** A shared UUID-format Zod schema applied to the `id` dynamic route segment on `/api/items/[id]` and `/api/flashcards/[id]` (GET/PATCH/DELETE), checked before the value reaches the database query. Today a malformed `id` (e.g. `GET /api/items/not-a-uuid`) throws an uncaught Postgres error and returns a generic, unhandled 500; after this ticket it returns a clean 400 with field-level detail via spec 08's `ValidationError`/`issues` mechanism.

**Blocked by:** 13 (Zod-to-ValidationError bridge)

**Status:** done
**Completed:** on `feat/15-id-route-param-uuid-validation`
**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/15

- [x] Shared UUID-param Zod schema added (this is the first genuine duplication point for a route-param schema — factor it into a shared module per the `request-fields.ts` pattern)
- [x] Schema applied to the `id` param on every handler of `/api/items/[id]` and `/api/flashcards/[id]`
- [x] A malformed `id` returns a 400 with `issues` via `withErrorHandling`, not an unhandled 500
- [x] A well-formed but nonexistent UUID still reaches the service layer and produces the existing `NotFoundError` behavior unchanged
- [x] Vitest: malformed-id case for each handler on both routes asserts the 400/`issues` response; valid-UUID case is unaffected by the new check
