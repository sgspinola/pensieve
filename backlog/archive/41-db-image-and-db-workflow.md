# 41: Dedicated DB image and `db.yml` workflow

**What to build:** The database gets its own artifact and CI, so an app build is no longer a migration artifact. A top-level `db/` directory holds the DB image's Dockerfile and its migration entrypoint, moved out of the app. It's built with the same hardening as the app image (esbuild-bundled entrypoints, distroless Node `nonroot` pinned by digest, arm64) and contains only the Drizzle migrations, the migrate entrypoint (using ticket 40's helper) and the RDS CA bundle. The app image drops the migrator and the SQL, keeping only the migration journal. App e2e migrates its throwaway Postgres with `npm run db:migrate`. A new `db.yml` workflow runs only when database inputs change: it builds and scans the image and proves every migration applies to an empty database. Spec: `backlog/specs/13-database-lifecycle.md` (user stories 1–3, 12, 13, 26; "Repository layout", "DB image", "`db.yml` workflow"), plus the spec 10 revisions to stories 33/34.

**Blocked by:** 40 (shared connection helper)

**Status:** done

**Completed:** on `feat/41-db-image-and-db-workflow`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/34

- [x] `db/` holds the DB image's Dockerfile and the migrate entrypoint (moved from the app's ops sources); the app's `build:ops` keeps only the healthcheck
- [x] DB image: distroless Node `nonroot` pinned by digest, arm64 only, contains `drizzle/`, `migrate.cjs` and the RDS CA bundle, and no Next.js or app code; hadolint-clean; Dependabot tracks its base digest
- [x] App image no longer contains the migrator or migration SQL, only `drizzle/meta/_journal.json`
- [x] App e2e migrates with `npm run db:migrate` instead of the image's migrator and still passes
- [x] `db.yml` triggers on `pull_request`/`push` to `develop`/`main`, and every job runs on every trigger (no `changes` job, no path filters, no `on: paths:`)
- [x] `db-image` job builds the DB image and runs Trivy secret and vulnerability scans as `ci.yml` does for the app (SARIF to Code Scanning, same exceptions files)
- [x] `db-apply` job applies every migration from scratch with the built image against a `postgres:17-alpine` service
- [x] Each `db.yml` job is added by name to the `develop` and `main` rulesets' required checks (there's no aggregate `gate` job; see spec 10)
- [x] Spec 10's CI docs/comments and `docs/` pages describing the image or e2e flow updated

**Implementation notes:**
- `db/migrate.ts` (moved from `src/ops/migrate.ts`) is bundled by `npm run build:db`; `db/Dockerfile` is built from the repo root (`docker build -f db/Dockerfile .`), and its builder copies only `db/`, `src/db/` and `tsconfig.json`. The image's default command is `migrate.cjs`.
- The DB image's Trivy vulnerability scan sees only the distroless base: `migrate.cjs` is one esbuild bundle. Its npm packages (drizzle-orm, postgres, the RDS signer) also ship in the app image, where `ci.yml`'s `trivy` job scans them.
- `db-apply` also checks that Drizzle's bookkeeping table records one row per journal entry.
- Verified locally: both images built for arm64; the DB image migrated a fresh Postgres (13/13, idempotent, exit 1 on unreachable DB or missing env); both Trivy scans clean; Playwright 37/37 against the app image after `npm run db:migrate`.
