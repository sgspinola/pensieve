# 23: Propagate requestId into every log line for a request

**What to build:** Every log line a request produces — including service-layer mutation logs like "Item created"/"Tag created" — should carry the same `requestId` as that request's baseline "Request handled" line and its `x-request-id` response header, with no changes to individual service call sites. Today, `withErrorHandling` reads `requestId` off the request header for its own baseline log line, but never binds it into LogTape's `AsyncLocalStorage` context, so anything the wrapped handler calls downstream (e.g. `createItem` → `logMutationSuccess`) runs with no bound context and never gets `requestId` attached.

**Blocked by:** 22 (manual verification of this ticket relies on ticket 22's JSON Lines formatter already rendering `record.properties` in the log file)

**Status:** done

**Completed:** on `feat/23-request-id-context-binding`

**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/23

- [x] `withErrorHandling` in `src/lib/api-errors.ts` wraps the handler call in `withContext({ requestId }, () => handler(request, ...rest))`
- [x] New test in `src/lib/api-errors.test.ts` proving a nested logger call made from inside the wrapped handler (simulating a mutation log) picks up `requestId` in its `record.properties`
- [x] `docs/architecture/error-handling-logging.md`'s correlation-ID and mutation-logging sections updated to describe the new binding
- [x] Manually verified end-to-end: a real `POST /api/items` request through the real route handler produced an "Item created" log line whose `requestId` matches the request's `x-request-id` header
