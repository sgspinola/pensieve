# 13: Zod adoption — shared Zod-to-ValidationError bridge

**What to build:** Add `zod` as a dependency and a small shared helper (e.g. `src/lib/validation.ts`) that runs a Zod schema against a value and, on failure, throws `ValidationError` populated with the field-level `issues: [{ field, message }]` list spec 08 ticket 04 adds. On success it returns the parsed, typed value. This is the one piece of shared infrastructure every other input-validation ticket builds on — it is not itself a per-route schema, and it does not pre-build a schema library ahead of need.

**Blocked by:** 04 (central-error-handling-wrapper — needs `ValidationError.issues` and the shared error envelope to exist first)

**Status:** done

**Completed:** on `feat/13-zod-validation-error-bridge`

**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/8

- [x] `zod` added to `package.json`
- [x] Shared helper added (e.g. `parseOrThrow(schema, data)`) that returns the parsed value on success and throws `ValidationError` with populated `issues` on failure — no coercion, strict fail-closed parsing
- [x] `issues` entries map cleanly from Zod's own issue format (`field` from the issue path, `message` from the issue message)
- [x] Vitest: valid input passes through unchanged (aside from any schema-declared narrowing); a schema with multiple simultaneous violations produces one `ValidationError` with one `issues` entry per violation
- [x] Vitest: a nested/array path (e.g. `tags[1]`) produces a readable `field` value
