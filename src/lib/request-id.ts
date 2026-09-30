// Conventional de-facto standard header (used by most reverse proxies/load
// balancers) for propagating a request correlation ID end to end. Shared by
// src/proxy.ts (which stamps/forwards it) and src/lib/api-errors.ts (which
// reads it back inside a route handler for the error envelope's requestId)
// so the two can't drift apart on the header name. Deliberately its own
// tiny, side-effect-free module rather than importing directly from
// src/proxy.ts: Proxy is invoked separately from route-handler code, and
// Next's own docs warn against relying on shared modules between them (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
// proxy.md, "Good to know") — this constant carries no such risk, but the
// Proxy module as a whole (its side-effecting ensureLoggingConfigured() call,
// its `config`/matcher export) does.
export const REQUEST_ID_HEADER = "x-request-id";
