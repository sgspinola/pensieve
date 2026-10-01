# 35: e2e against the built image in CI

**What to build:** The Playwright suite runs in CI against the *built production image*, not `next dev`, so standalone-output, Dockerfile, migration-entrypoint and hydration breakages are caught before production. An `e2e` job runs inside the official Playwright v1.63.0 container on an arm64 runner: it loads the image artifact, starts a fresh disposable Postgres service container, runs the image's migration entrypoint against it as the superuser, starts the app container, waits on the health endpoint, then runs Playwright with `PLAYWRIGHT_BASE_URL` set. The existing global setup/teardown seed and clean up the session user directly through `DATABASE_URL` as today. Spec: `backlog/specs/10-ci-pipeline.md` (user stories 34, 35).

**Blocked by:** 33 (image artifact from `build`)

**Status:** done

**Completed:** on `feat/35-e2e-against-built-image`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/24

- [x] **e2e** job runs in the Playwright v1.63.0 container on an arm64 runner. (Revised, see the spec's e2e bullet: the job runs on the `ubuntu-24.04-arm` host and starts the digest-pinned Playwright image with `docker run --network host`, rather than using it as the job container. That image has no Docker CLI to load and start the app, and the production `Secure` session cookie only works over plain HTTP on `localhost`.)
- [x] Fresh Postgres service container per run; migrations applied via the image's migration entrypoint (not drizzle-kit): `docker run pensieve:ci migrate.cjs`, as the superuser
- [x] App container started from the loaded image; job waits for the health endpoint to return 200 before running tests (`curl --retry`)
- [x] Playwright runs with `PLAYWRIGHT_BASE_URL` pointing at the app container; existing specs pass unchanged: 37/37 in PR #24's first CI run, and in a local rehearsal
- [x] Playwright report uploaded as an artifact on failure (3-day retention), plus the app container's logs; step summary written, and marked failed on global setup/teardown errors too
- [x] `e2e` added to ticket 36's required-checks list (already listed there), ~20-minute timeout, SHA-pinned actions
