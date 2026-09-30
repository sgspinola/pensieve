# 20: Import endpoints — migrate to Zod schemas

**What to build:** Migrate `items/import`, `items/import/preview`, `flashcards/import`, and `flashcards/import/preview` from the existing hand-rolled `parseImportFileBody`/`parseKindAndFileBody` helpers in `src/lib/request-fields.ts` to Zod schemas, preserving current accepted shapes (`{ file: string }` and `{ kind: string, file: string }`). `import/sample` routes take no input and are unaffected.

**Blocked by:** 13 (Zod-to-ValidationError bridge)

**Status:** done

**Completed:** on `feat/20-import-endpoints-zod-migration`
**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/14

- [x] Zod schema for the `{ file: string }` body shape, replacing `parseImportFileBody`
- [x] Zod schema for the `{ kind: string, file: string }` body shape (kind constrained to valid importable item kinds), replacing `parseKindAndFileBody`/`parseItemImportBody`
- [x] `flashcards/import` and `flashcards/import/preview` updated to use the new schemas
- [x] `items/import` and `items/import/preview` updated to use the new schemas
- [x] The now-unused hand-rolled helpers removed from `request-fields.ts` if nothing else references them
- [x] TypeScript types inferred via `z.infer`
- [x] Vitest: valid case and each distinct invalid-shape case (missing `file`, missing/invalid `kind`) asserted against the resulting `issues`, for both the flashcards and items variants
