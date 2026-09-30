# 05: Error-handling rollout — items routes

**What to build:** Apply `withErrorHandling` across every route under `src/app/api/items/**`, replacing per-route `try/catch`, and replace `items/route.ts`'s hand-written inline 400 response with a real `ValidationError` throw so it goes through the same taxonomy and envelope as everything else.

**Blocked by:** 04 (Central withErrorHandling wrapper, response envelope, and baseline request logging)

**Status:** done

**Completed:** on `feat/05-error-handling-rollout-items-routes`

**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/11

- [x] `src/app/api/items/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `src/app/api/items/[id]/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `src/app/api/items/export/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `src/app/api/items/import/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `src/app/api/items/import/preview/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `src/app/api/items/import/sample/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `src/app/api/items/metadata/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `items/route.ts`'s inline `NextResponse.json({ error: "..." }, { status: 400 })` replaced with a `ValidationError` throw
- [x] Existing tests for these routes (e.g. `items/route.test.ts`) pass, updated where they assert on error response shape to match the new envelope
