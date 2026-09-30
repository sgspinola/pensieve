# 17: Item body validation — create, update, metadata preview

**What to build:** Zod schemas for `POST /api/items` (create) and the body of `PATCH /api/items/[id]` (update), plus `POST /api/items/metadata` (`url`) since it feeds the same item-creation flow. Replaces the current hand-rolled checks (`isStringArray`, ad hoc `typeof` checks on `parentId`, etc.) in these route handlers.

**Blocked by:** 13 (Zod-to-ValidationError bridge)

**Status:** done

**Completed:** on `feat/17-item-body-validation`

**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/19

- [x] Zod schema for the `POST /api/items` create body (url/title/description/notes/content/tags/parentId/kind, matching existing field semantics per item kind)
- [x] Zod schema for the `PATCH /api/items/[id]` update body (same updatable fields, all optional, `kind` still rejected as immutable)
- [x] Zod schema for the `POST /api/items/metadata` body (`url: string`, valid URL format)
- [x] Existing hand-rolled shape checks in these three handlers removed in favor of the schemas; `pickProvidedFields`/`request-fields.ts` usage preserved where it still adds value (picking only provided keys for PATCH)
- [x] TypeScript types for each parsed body inferred via `z.infer`
- [x] Vitest: valid case and each distinct invalid-shape case (wrong type per field, `tags` not a string array, attempted `kind` change on PATCH, malformed `url` on metadata) asserted against the resulting `issues`
