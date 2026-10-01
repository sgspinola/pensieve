# 29: Deployable container image, verified locally

**What to build:** A hardened production container image that can be built and run on the maintainer's machine, with the existing Playwright suite passing against it. Enable Next's standalone output; add a denylist `.dockerignore` (critically `.env*`, since `next build` copies `.env`/`.env.production` into the standalone bundle); write a multi-stage Dockerfile whose runtime stage is distroless Node 24 `nonroot`, pinned by digest, built for `linux/arm64`, copying only the standalone server, static and public assets, Drizzle migration SQL and the migration entrypoint. The image ships a migration entrypoint (drizzle-orm's built-in migrator, not drizzle-kit, connecting via `DATABASE_URL`, exit 0/non-zero) and a Node `HEALTHCHECK` script that calls the health endpoint (distroless has no `curl`). Playwright gains `PLAYWRIGHT_BASE_URL` support that disables the config's `webServer` block so it can target the running image. Spec: `backlog/specs/10-ci-pipeline.md` (user stories 23–26, 30, 33, 34, 53).

**Blocked by:** 26 (production build must succeed), 28 (health endpoint for `HEALTHCHECK`)

**Status:** done

**Completed:** on `feat/29-deployable-container-image`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/11

- [x] Next config sets `output: "standalone"`
- [x] `.dockerignore` excludes at least `.env*`, `*.pem`, `.git`, `node_modules`, `.next`, `coverage`, `logs`, `e2e/.auth`, `test-results`, `playwright-report`, `graphify-out`
- [x] Multi-stage Dockerfile: full Node builder runs `npm ci` (with pinned npm 11.16.0) and `next build`; runtime is `gcr.io/distroless/nodejs24-debian13:nonroot` pinned by digest, runs as non-root, no `sharp`
- [x] `docker build --platform linux/arm64 .` succeeds locally
- [x] Migration entrypoint applies all migrations to an empty Postgres and exits 0; exits non-zero on failure (e.g. unreachable DB)
- [x] `HEALTHCHECK` script reports healthy once the app and DB are up, unhealthy when the DB is down
- [x] With `PLAYWRIGHT_BASE_URL` set, Playwright skips `webServer` and the existing e2e specs pass against the running image (global setup still seeds via `DATABASE_URL`) — 32/37 pass; the other 5 (`wiki.spec.ts` ×3, `items.spec.ts` tag cloud, `flashcards-study.spec.ts`) fail identically against `next dev` on `develop` (stale selectors from UI drift, e.g. waiting for "Add item" where the wiki form now says "Add page"), so they are pre-existing and out of scope here
- [x] Manually confirmed: a local `.env` present in the working tree does not end up in the image
- [x] Run instructions (build, migrate, run, e2e against image) documented in the README
- [x] `docs/architecture/` updated for the deployable artifact shape, per the docs conventions
