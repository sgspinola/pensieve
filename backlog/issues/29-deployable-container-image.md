# 29: Deployable container image, verified locally

**What to build:** A hardened production container image that can be built and run on the maintainer's machine, with the existing Playwright suite passing against it. Enable Next's standalone output; add a denylist `.dockerignore` (critically `.env*`, since `next build` copies `.env`/`.env.production` into the standalone bundle); write a multi-stage Dockerfile whose runtime stage is distroless Node 24 `nonroot`, pinned by digest, built for `linux/arm64`, copying only the standalone server, static and public assets, Drizzle migration SQL and the migration entrypoint. The image ships a migration entrypoint (drizzle-orm's built-in migrator, not drizzle-kit, connecting via `DATABASE_URL`, exit 0/non-zero) and a Node `HEALTHCHECK` script that calls the health endpoint (distroless has no `curl`). Playwright gains `PLAYWRIGHT_BASE_URL` support that disables the config's `webServer` block so it can target the running image. Spec: `backlog/specs/10-ci-pipeline.md` (user stories 23–26, 30, 33, 34, 53).

**Blocked by:** 26 (production build must succeed), 28 (health endpoint for `HEALTHCHECK`)

**Status:** ready-for-agent

- [ ] Next config sets `output: "standalone"`
- [ ] `.dockerignore` excludes at least `.env*`, `*.pem`, `.git`, `node_modules`, `.next`, `coverage`, `logs`, `e2e/.auth`, `test-results`, `playwright-report`, `graphify-out`
- [ ] Multi-stage Dockerfile: full Node builder runs `npm ci` (with pinned npm 11.16.0) and `next build`; runtime is `gcr.io/distroless/nodejs24-debian13:nonroot` pinned by digest, runs as non-root, no `sharp`
- [ ] `docker build --platform linux/arm64 .` succeeds locally
- [ ] Migration entrypoint applies all migrations to an empty Postgres and exits 0; exits non-zero on failure (e.g. unreachable DB)
- [ ] `HEALTHCHECK` script reports healthy once the app and DB are up, unhealthy when the DB is down
- [ ] With `PLAYWRIGHT_BASE_URL` set, Playwright skips `webServer` and the existing e2e specs pass against the running image (global setup still seeds via `DATABASE_URL`)
- [ ] Manually confirmed: a local `.env` present in the working tree does not end up in the image
- [ ] Run instructions (build, migrate, run, e2e against image) documented in the README
- [ ] `docs/architecture/` updated for the deployable artifact shape, per the docs conventions
