# 28: Health endpoint

**What to build:** An unauthenticated `GET` health route that the container runtime and the CI e2e job can poll to tell when the app is genuinely ready. It performs a trivial `SELECT 1` and returns 200 when the database answers, or a safe 503 with no internal detail when it doesn't. The request proxy's auth gate exempts exactly this route and nothing else — the smallest possible exception to "everything behind auth." Spec: `backlog/specs/10-ci-pipeline.md` (user stories 30–32).

**Blocked by:** None (can start immediately)

**Status:** done

**Completed:** on `feat/28-health-endpoint`

**Pull Request:** _not yet opened — branch is local only; add the URL once pushed_

- [x] New `GET` health route returns 200 with a minimal up body when `SELECT 1` succeeds
- [x] Returns 503 with a minimal down body and no error message, stack or connection detail when the DB query fails (failure still logged server-side; a query that hasn't answered within 2s also counts as a failure, so an unreachable host doesn't hold the probe for postgres.js's 30s connect timeout)
- [x] Proxy auth gate exempts exactly the health route path; no other path becomes public
- [x] Vitest tests call the route handler directly (following the existing API route tests): 200 on DB success, safe 503 on DB failure, and reachable without a session (asserted against the proxy's exemption logic)
- [x] Docs page under `docs/flows/` added/updated for the health check flow, and `docs/METHODOLOGY.md` updated accordingly
