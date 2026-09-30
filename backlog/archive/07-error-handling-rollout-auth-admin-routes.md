# 07: Error-handling rollout — auth and admin routes

**What to build:** Apply `withErrorHandling` across every route under `src/app/api/auth/**` and `src/app/api/admin/invites/route.ts`, replacing per-route `try/catch`. This batch includes the two routes (`auth/logout`, `auth/login/options`) that currently have no error handling at all — bringing their failure behavior in line with the rest instead of leaving it accidental.

**Blocked by:** 04 (Central withErrorHandling wrapper, response envelope, and baseline request logging)

**Status:** done
**Completed:** on `feat/07-error-handling-rollout-auth-admin-routes`
**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/9

- [x] `src/app/api/auth/invite/options/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `src/app/api/auth/invite/verify/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `src/app/api/auth/login/options/route.ts` gains error handling for the first time via `withErrorHandling`
- [x] `src/app/api/auth/login/verify/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `src/app/api/auth/logout/route.ts` gains error handling for the first time via `withErrorHandling`
- [x] `src/app/api/auth/recover/options/route.ts` exports its handler(s) through `withErrorHandling` (already migrated as ticket 04's own pilot route; verified correct, unmodified here)
- [x] `src/app/api/auth/recover/verify/route.ts` exports its handler(s) through `withErrorHandling` (already migrated as ticket 04's own pilot route; verified correct, unmodified here)
- [x] `src/app/api/auth/register/options/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `src/app/api/auth/register/verify/route.ts` exports its handler(s) through `withErrorHandling`
- [x] `src/app/api/admin/invites/route.ts` exports its handler(s) through `withErrorHandling`
- [x] Existing tests for these routes pass, updated where they assert on error response shape to match the new envelope (no pre-existing route-level tests needed updating; new tests added for `login/options` and `logout`, the two routes that previously had no error handling at all)
