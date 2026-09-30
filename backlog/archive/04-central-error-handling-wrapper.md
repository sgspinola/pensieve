# 04: Central withErrorHandling wrapper, response envelope, and baseline request logging

**What to build:** Extend the existing `toErrorResponse` (`src/lib/api-errors.ts`) into a `withErrorHandling(handler)` wrapper that every API route will export its handler through. It maps `AppError` subclasses to a consistent `{ error: { code, message, requestId? } }` envelope, collapses any unexpected throw into a generic safe 500 (with `requestId` included so a user can report it), and logs one baseline line per request. Proven end-to-end on a small pilot before the full rollout (tickets 05–07) applies it everywhere.

**Blocked by:** 01 (AppError taxonomy refactor), 03 (Request correlation ID)

**Status:** done

**Completed:** on `feat/04-central-error-handling-wrapper`

**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/6

- [x] `withErrorHandling(handler)` added to `src/lib/api-errors.ts`, extending the existing `toErrorResponse`
- [x] `AppError` subclasses pass through their own `code`/`message` into the `{ error: { code, message, requestId? } }` envelope
- [x] Any unexpected/unhandled throw collapses to a generic, safe code/message with no stack trace or internal detail leaked, and includes `requestId`
- [x] `AppError` failures log at `warn`; unexpected failures log at `error`
- [x] Every wrapped request logs one baseline line: route/method, response status, duration (ms), authenticated user ID (not email), and request ID
- [x] Wrapper applied to 1–2 pilot routes as proof, end to end, ahead of the full rollout
- [x] Vitest: invoke a wrapped handler and assert the JSON envelope/status for each `AppError` subclass, plus the generic-500 case for an unexpected throw
- [x] Vitest: register an in-memory LogTape test sink and assert on the captured baseline log fields for a pilot route
