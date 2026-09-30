# 18: Flashcard body validation — create & update

**What to build:** Zod schemas for `POST /api/flashcards` (create) and the body of `PATCH /api/flashcards/[id]` (update), replacing any hand-rolled shape checks currently in those handlers.

**Blocked by:** 13 (Zod-to-ValidationError bridge)

**Status:** done

**Completed:** on `feat/18-flashcard-body-validation`

**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/18

- [x] Zod schema for the `POST /api/flashcards` create body (front/back/tags, matching existing field semantics)
- [x] Zod schema for the `PATCH /api/flashcards/[id]` update body (same fields, all optional)
- [x] Existing hand-rolled shape checks in these two handlers removed in favor of the schemas
- [x] TypeScript types for each parsed body inferred via `z.infer`
- [x] Vitest: valid case and each distinct invalid-shape case asserted against the resulting `issues`
