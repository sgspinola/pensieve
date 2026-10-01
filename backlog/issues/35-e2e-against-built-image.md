# 35: e2e against the built image in CI

**What to build:** The Playwright suite runs in CI against the *built production image*, not `next dev`, so standalone-output, Dockerfile, migration-entrypoint and hydration breakages are caught before production. An `e2e` job runs inside the official Playwright v1.63.0 container on an arm64 runner: it loads the image artifact, starts a fresh disposable Postgres service container, runs the image's migration entrypoint against it as the superuser, starts the app container, waits on the health endpoint, then runs Playwright with `PLAYWRIGHT_BASE_URL` set. The existing global setup/teardown seed and clean up the session user directly through `DATABASE_URL` as today. Spec: `backlog/specs/10-ci-pipeline.md` (user stories 34, 35).

**Blocked by:** 33 (image artifact from `build`)

**Status:** ready-for-agent

- [ ] **e2e** job runs in the Playwright v1.63.0 container on an arm64 runner
- [ ] Fresh Postgres service container per run; migrations applied via the image's migration entrypoint (not drizzle-kit)
- [ ] App container started from the loaded image; job waits for the health endpoint to return 200 before running tests
- [ ] Playwright runs with `PLAYWRIGHT_BASE_URL` pointing at the app container; existing specs pass unchanged
- [ ] Playwright report uploaded as an artifact on failure (short retention); step summary written
- [ ] Included in `ci-ok`'s needs, ~20-minute timeout, SHA-pinned actions
