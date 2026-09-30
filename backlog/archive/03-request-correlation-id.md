# 03: Request correlation ID

**What to build:** `middleware.ts` stamps every incoming request with a correlation ID and binds it (plus other request-scoped fields) once via LogTape's `AsyncLocalStorage`-based context, so every nested logger call anywhere in that request's call graph automatically includes it — no explicit parameter threading. The ID is also surfaced back on the response.

**Blocked by:** 02 (LogTape structured logging setup)

**Status:** done

**Completed:** on `feat/03-request-correlation-id`

**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/3

**Note:** this repo is on Next.js 16, which renamed the `middleware.ts` file convention to `proxy.ts` (the exported function is `proxy`, not `middleware`) — see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`. All work below landed in `src/proxy.ts`, this app's actual request-entry point, rather than a `middleware.ts` file.

- [x] `configure({ contextLocalStorage: new AsyncLocalStorage() })` wired into the LogTape setup from ticket 02
- [x] `src/proxy.ts` generates a request ID (`crypto.randomUUID()`) when the inbound request doesn't already carry one (including when the header is present but empty), and preserves an existing one
- [x] The request lifecycle is wrapped in `withContext({ requestId, ... })` so every nested `getLogger(...)` call during that request includes the ID with no manual threading — `ensureLoggingConfigured()` is also awaited first so this can't silently no-op on cold start
- [x] The request ID is surfaced back to the caller as a response header (`x-request-id`)
- [x] Vitest: call `proxy()` directly with a constructed request; assert it stamps `x-request-id` when absent (including the empty-header case) and preserves an existing one
