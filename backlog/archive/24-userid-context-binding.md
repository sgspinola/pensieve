# 24: Propagate userId into every log line for a request

**What to build:** Every log line a request produces — including service-layer mutation logs like "Item created"/"Tag created" — should carry the acting user's `userId`, the same way ticket 23 propagated `requestId` into every log line. Today, `withErrorHandling` already resolves `userId` via `currentUserId()` for its own baseline "Request handled" log line, but never binds it into LogTape's `AsyncLocalStorage` context, so anything the wrapped handler calls downstream (e.g. `createItem` → `logMutationSuccess`) runs with no bound `userId` and never gets it attached. Audit logs without a reliable actor are far less useful, so this closes that gap with the same mechanism, at the same choke point, ticket 23 already established.

**Blocked by:** 23 (reuses the exact `withContext({ requestId }, ...)` binding that ticket introduced, in `src/lib/api-errors.ts`)

**Status:** done

**Completed:** on `feat/24-userid-context-binding`

**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/24

- [x] `withErrorHandling` in `src/lib/api-errors.ts` binds `userId` alongside `requestId` in its `withContext({ requestId, userId }, () => handler(request, ...rest))` call
- [x] New test in `src/lib/api-errors.test.ts` proving a nested logger call made from inside the wrapped handler (simulating a mutation log) picks up `userId` in its `record.properties` when the request is authenticated, and omits/undefines it when it isn't
- [x] `docs/architecture/error-handling-logging.md`'s correlation-ID and mutation-logging sections updated to describe `userId` flowing through the same binding as `requestId`
- [x] Manually verified: seeded a real DB-backed user/session (same mechanism as `e2e/global-setup.ts`) and drove `withErrorHandling` through the automated context-binding tests, confirming a nested "Item created" log line's `userId` matches the seeded session's user id — a separate live-server curl check was skipped to avoid disturbing the maintainer's already-running local `next dev` instance
