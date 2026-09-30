# 06: Error-handling rollout — flashcards routes

**What to build:** Apply `withErrorHandling` across every route under `src/app/api/flashcards/**`, replacing per-route `try/catch`, and replace `flashcards/route.ts`'s hand-written inline 400 response with a real `ValidationError` throw so it goes through the same taxonomy and envelope as everything else.

**Blocked by:** 04 (Central withErrorHandling wrapper, response envelope, and baseline request logging)

**Status:** done
**Completed:** on `feat/06-error-handling-rollout-flashcards-routes`
**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/10

- [x] `src/app/api/flashcards/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `src/app/api/flashcards/[id]/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `src/app/api/flashcards/export/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `src/app/api/flashcards/import/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `src/app/api/flashcards/import/preview/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `src/app/api/flashcards/import/sample/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `flashcards/route.ts`'s inline `NextResponse.json({ error: "..." }, { status: 400 })` replaced with a `ValidationError` throw
- [x] Existing tests for these routes (e.g. `flashcards/route.test.ts`, `[id]/route.test.ts`) pass, updated where they assert on error response shape to match the new envelope
