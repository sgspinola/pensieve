# 44: Two-sided startup schema check

**What to build:** The app refuses to start against a schema it can't handle, so ECS's circuit breaker rolls back a deploy in the wrong order. At boot the app reads Drizzle's bookkeeping table and `pensieve_meta.schema_compat`, and compares them with the migration journal bundled in its image. It exits with an error when the database is too old (a journal tag isn't applied) or the app is too old (the newest breaking migration in the database isn't in its journal). A database ahead only by additive migrations is fine. Spec: `backlog/specs/13-database-lifecycle.md` (user stories 9–11; "Startup check"); `backlog/specs/11-aws-infrastructure.md` (user story 41).

**Blocked by:** 42 (app role `SELECT` grants), 43 (`schema_compat` table)

**Status:** in-review

- [x] The check runs once at app startup, before the app serves traffic, and a failure exits the process with a clear logged reason
- [x] It accepts an exact match and a database ahead only by additive migrations
- [x] It rejects a missing journal tag (DB too old) and a newer breaking migration (app too old)
- [x] Vitest tests (database seam) cover all four cases from a given journal and database state
- [x] Local dev, unit CI and e2e (which migrate with drizzle-kit and have no `pensieve_meta`) still start. How a missing `schema_compat` is treated is decided and tested
- [x] `docs/flows/` updated for the startup flow

**Implementation notes:**
- `src/instrumentation.ts`'s `register()` (Next awaits it once per server, before serving; Node.js runtime only, not during `next build`) runs `src/db/startup-check.ts`, which connects through `connect()` (10s connect timeout), reads `drizzle/meta/_journal.json` and calls `checkSchemaCompatibility()` in `src/db/schema-check.ts`. Any failure, including an unreachable database, logs a `FATAL` line with the reason (message only, never the driver error) and calls `process.exit(1)`. Under `next dev` the reason is also printed to the terminal, since the dev logger writes only to `logs/`.
- Database too old: a journal entry whose `when` isn't a `created_at` in `drizzle.__drizzle_migrations` (the same mapping the migrator uses). App too old: `schema_compat.breaking_tag` set and not a journal tag.
- **Missing `schema_compat` decision:** a missing table (or row) means no breaking migration is on record, so only the database-too-old side applies. drizzle-kit (local dev, unit CI, e2e) never creates `pensieve_meta`; in AWS the DB image's migrator creates the table in the same transaction as its first batch, so it can't be missing there while the migrations are applied. A missing bookkeeping table counts as nothing applied (database too old). Both are tested in `src/db/schema-check.test.ts`.
- The journal reader moved to `src/db/journal.ts`, shared by the app and the DB image's migrator (`db/migrations.ts`).
- Verified beyond Vitest: the standalone build exits 1 against an empty database before any request and serves `/api/health` 200 against a drizzle-kit-migrated one; `next dev` exits 1 against an empty database; `npm run test:e2e` passes (37).
- Judgement call: an unreachable database now stops the app at boot, locally too (previously it started and failed per request).
