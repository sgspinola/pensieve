# Health Check

Covers the readiness probe the container `HEALTHCHECK` and the CI e2e job
poll to tell when the app can actually serve requests. Route:
`src/app/api/health/route.ts` (`GET`), gated by `src/proxy.ts`.

It is the **only API route reachable without a session.** `/api/health` is
an exact entry in the proxy's `PUBLIC_PATHS` set (`proxy.ts:22-36`), so
look-alike paths (`/api/health/x`, `/api/healthz`) still go through the
normal session check and get a 401. To keep that exception as small as
possible, the response says nothing beyond up or down: `{ "status": "up" }`
or `{ "status": "down" }`. When the database doesn't answer, the error goes
to the server log only. It can carry a hostname, a port or a connection
string, so it never reaches the response body.

"Up" means the database answered a trivial `SELECT 1`, not just that the
Node process is alive. A broken DB connection therefore shows as unhealthy.
The query is raced against a 2-second timeout. Without it, an unreachable
host would hold the probe for postgres.js's 30-second connect timeout, far
longer than any probe waits, so a slow database also counts as down.

The handler is deliberately **not** wrapped in `withErrorHandling`, unlike
every other route. That wrapper turns a throw into a 500 and writes an info
log line per request. A probe polled every few seconds needs a 503 on
failure and no log noise while healthy.

```mermaid
sequenceDiagram
    actor Probe as Probe (HEALTHCHECK / CI e2e)
    participant Proxy as proxy.ts
    participant Route as GET /api/health
    participant DB as Postgres (via Drizzle)

    Probe->>Proxy: GET /api/health (no session cookie)
    alt isPublicPath(pathname) (proxy.ts:90-92)
        Note right of Proxy: exact match on "/api/health" —<br/>no session lookup
        Proxy->>Route: NextResponse.next() + x-request-id
        Route->>DB: execute(sql`select 1`), raced against a 2s timeout
        alt DB answers within 2s
            DB-->>Route: row
            Route-->>Probe: 200 { status: "up" }
        else catch_clause: query fails or times out (route.ts:32-35)
            DB-->>Route: throws / no answer
            Note right of Route: logger.error("Health check failed: database unreachable", { error })<br/>— error detail stays in the log
            Route-->>Probe: 503 { status: "down" }
        end
    else any other path, e.g. /api/healthz (proxy.ts:113-119)
        Proxy->>Proxy: getSessionUser(db, undefined) throws
        Proxy-->>Probe: 401 { error: "Unauthorized" }
    end
```
