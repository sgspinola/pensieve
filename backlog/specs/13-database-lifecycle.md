# 13: Database lifecycle (bootstrap, migrations, DB pipeline and deploys)

## Problem Statement

Specs 10–12 couple the database to the application at every stage. The coupling starts with the artifact: the app image ships the Drizzle migration SQL and a migration entrypoint, built in tickets 29 and 35, so every app build is also a migration artifact. Spec 11 extends it:
- the one-off `db-bootstrap` task runs the app image too
- the app refuses to start unless the database *exactly* matches the migrations bundled in it

Spec 12's single deploy script then makes every app release a database release: stop the app, snapshot, migrate, start the new version, every time.

So the database can't change without an app build, an app release always carries schema risk (and a snapshot and downtime), and the two can't be rolled back independently. The maintainer wants the database's CI/CD separated from the application's as far as is practical.

Three constraints shape the design:
- **Downtime is acceptable.** Pensieve is a one-to-two-user personal app with no availability requirement, so the app can be stopped while the schema changes. No zero-downtime discipline is needed.
- **`schema.ts` is shared.** The app's typed Drizzle queries are generated from the same schema file the migrations come from, so authoring can't be split across repositories without a published schema package.
- **The RDS master credential must never reach GitHub.** Deploys move to GitHub CD (spec 12), but anything holding master power stays a local, deliberate act.

## Solution

The database gets its own artifact, its own CI workflow and its own deploy workflow. It stays in this repository next to the schema it's generated from.

- **A dedicated DB image** built from a top-level `db/` directory holds:
  - the Drizzle migration SQL
  - the migration entrypoint (moved out of the app)
  - an idempotent bootstrap script that creates the database roles and grants

  It's published to its own `pensieve-db` ECR repository, signed and with an SBOM, exactly like the app image. The app image drops the migrator and the SQL.
- **A coordinated-window contract.** A migration that the running app can tolerate is *additive* and deploys on its own; the app is restarted on the same revision. A migration that would break the running app is *breaking*. It's marked as such in its SQL, and it can only deploy in a single maintenance window together with the app version that expects it.
- **A two-sided startup check.** The app ships only the list of migration tags it was built against. It refuses to start if the database is missing one of them (DB too old), or if the database holds a breaking migration newer than its own latest (app too old). A database that's ahead with only additive migrations is fine.
- **A `db.yml` CI workflow** that, when database inputs change, proves the migrations apply both from scratch and on top of the last released schema, that the role grants work, and that `schema.ts` and the committed SQL agree.
- **A `deploy-db` workflow**, manually dispatched and approved, that runs the maintenance window: stop the app, snapshot, migrate, then start the previous app revision, or the new one for a breaking migration.
- **A local `db-bootstrap` script**, run with the maintainer's SSO credentials, that launches the bootstrap as a one-off ECS task. That task is the only thing that can read the RDS master secret.

## User Stories

1. As the maintainer, I want migrations packaged in their own image, so that an app build is no longer a migration artifact and the two can be released independently.
2. As the maintainer, I want the app image to contain no migration SQL or migrator, so that it's smaller and can't be used to change the schema.
3. As a developer, I want `schema.ts` and the migrations to stay in this repository, so that a schema change and the code using it remain one reviewable PR.
4. As the maintainer, I want an additive migration (new table, new nullable or defaulted column, new index) deployable on its own, so that schema changes don't wait for an app release.
5. As the maintainer, I want a breaking migration (drop, rename, type change, new constraint the current app would violate) to deploy only together with the app version that expects it, so that a running app never sees a schema it can't handle.
6. As a developer, I want to declare a migration breaking with a marker in its SQL, so that the decision is explicit and visible in the PR diff.
7. As the maintainer, I want the migrator to refuse a pending breaking migration when no new app version was supplied, so that forgetting the coordinated window fails safely instead of breaking the app.
8. As the maintainer, I want a refused or failed migration to leave the schema untouched and the previous app running again, so that a mistake costs only a few minutes of downtime.
9. As an operator, I want the app to refuse to start when the database lacks a migration it was built with, so that deploying an app before its migration fails fast and rolls back.
10. As an operator, I want the app to refuse to start when the database holds a breaking migration newer than the app, so that restarting an old app on a broken schema fails fast too.
11. As an operator, I want the app to start normally when the database is ahead only by additive migrations, so that additive DB deploys never require an app release.
12. As the maintainer, I want DB CI to run only when database inputs change, so that app-only changes don't pay for it. (Revised during ticket 38's reversal: dropped. Path-conditional jobs were rejected for both workflows, so the DB jobs run on every change, like the app's. Reinstated during ticket 41 as a workflow-level `on: paths:` filter, with the DB jobs taken out of the required checks; see "`db.yml` workflow".)
13. As the maintainer, I want every migration applied to an empty database in CI, so that a fresh environment can always be built from the migrations alone.
14. As the maintainer, I want new migrations applied on top of the schema of the last release in CI, so that the real production upgrade path is tested, not just a clean install.
15. As the maintainer, I want CI to fail when `schema.ts` and the committed migration SQL disagree, so that a forgotten `drizzle-kit generate` can't ship.
16. As the maintainer, I want CI to prove the app role can read and write rows but can't change the schema, and that tables created later are still writable by it, so that a missing grant is caught before production.
17. As the maintainer, I want the DB image published, signed and given an SBOM on `main` only when database inputs changed, so that the registry holds one image per real schema version, each verifiable.
18. As the maintainer, I want DB deploys run from a manually dispatched GitHub workflow that I must approve, so that schema changes are deliberate but don't depend on my laptop.
19. As the maintainer, I want `deploy-db` to verify the DB image's signature before using it, so that only images built by this repository's `main` pipeline can touch the schema.
20. As the maintainer, I want a snapshot taken right before every migration, so that a destructive migration can be undone by restoring.
21. As the maintainer, I want only the newest pre-deploy snapshot kept, so that manual snapshots don't accumulate cost; point-in-time recovery covers anything older.
22. As the maintainer, I want the deploy role allowed to delete only pre-deploy snapshots, so that a compromised workflow can't delete other backups.
23. As the maintainer, I want the RDS master credential never reachable from GitHub Actions, not even indirectly by launching a task that holds it, so that CI can never gain master power over the database.
24. As the maintainer, I want the database roles and grants created by an idempotent bootstrap I run locally, so that the one master-powered step is rare, deliberate and repeatable.
25. As the maintainer, I want the bootstrap to run inside AWS as a one-off task, so that I don't need a bastion or tunnel and the master password never lands on my machine.
26. As a developer, I want local development and app CI to keep migrating with `npm run db:migrate`, so that the DB image isn't needed anywhere outside AWS deploys and DB CI.

## Implementation Decisions

**Repository layout:**
- `src/db/schema.ts` and `drizzle/` stay where they are; `drizzle-kit generate` keeps producing the SQL.
- A new top-level `db/` directory holds the DB image's own sources:
  - its `Dockerfile`
  - the bootstrap SQL
  - the migration entrypoint, moved from `src/ops/migrate.ts`
  - the startup-check SQL it shares with the app, if any
- The app's `build:ops` keeps only the healthcheck.

**DB image:**
- Same base and hardening as the app image (spec 10): a builder stage bundles the entrypoints with esbuild, and the runtime stage is distroless Node `nonroot`, pinned by digest and arm64 only.
- It contains `drizzle/`, the migrate and bootstrap entrypoints, and the RDS CA bundle. No Next.js, no app code.
- It connects using the shared connection helper (spec 11): `DATABASE_URL` locally and in CI, IAM auth in AWS.
- Two commands:
  - **`migrate.cjs`**: the drizzle-orm migrator, with breaking-migration enforcement (below). (Revised during ticket 43: it applies drizzle's migration files and bookkeeping rows itself, using drizzle-orm's `readMigrationFiles`, rather than calling drizzle's `migrate()`, whose own transaction can't be nested inside the one that also covers the breaking check and `schema_compat`.)
  - **`bootstrap.cjs`**: runs the bootstrap SQL as the RDS master user, using the RDS-managed master secret.

**Breaking-migration marker:**
- A migration is breaking when its SQL file's first line is `-- pensieve:breaking`, added by hand after `drizzle-kit generate`. Everything else is additive.
- Rule of thumb, recorded in the deploy runbook: drops, renames, type changes, `NOT NULL` without a default, and new constraints existing rows or the current app could violate are breaking. New tables, nullable or defaulted columns and indexes are additive.
- No linter enforces the marker. It's a review-time judgement; the startup check is the backstop.

**Migrator behaviour:**
- Before applying, it computes the pending migrations by comparing the bundled journal with Drizzle's bookkeeping table.
- If any pending migration is breaking and the `ALLOW_BREAKING` environment variable isn't `true`, it exits non-zero with a message naming the breaking migrations, without applying anything. `deploy-db` sets that variable only when an `app_sha` was supplied.
- The migrator applies all pending migrations in one transaction, so a failure part-way also leaves the schema unchanged. (Revised during ticket 43: one transaction the migrator owns, which also covers the breaking check and the `schema_compat` upsert.)
- **Compat metadata:** in the same transaction, the migrator upserts a single-row table, `pensieve_meta.schema_compat`. It holds the tag of the newest *breaking* migration ever applied, and is null if there's none. The schema is owned by the migrator role, and the app role has `SELECT` on it only. (Revised during ticket 43: after a batch, every journal entry is applied, so the migrator records the journal's newest breaking tag, which covers one applied by drizzle-kit or before the table existed. With nothing pending, the database may be ahead of the image's journal, so the recorded tag is left alone.)

**Startup check (replaces spec 11's exact-match check):**
- At build time the app image includes `drizzle/meta/_journal.json`, which lists tags only, no SQL.
- At boot, the app reads Drizzle's bookkeeping table and `pensieve_meta.schema_compat`. It exits with an error, so ECS's circuit breaker rolls back, when either:
  - **DB too old:** a tag in its journal isn't recorded as applied.
  - **App too old:** the newest breaking migration in the database isn't in its journal.
- Otherwise it starts, even when the database has newer additive migrations.
- The app role therefore needs `SELECT` on Drizzle's bookkeeping table. This revises spec 11's "no access to the migration-bookkeeping schema".

**Bootstrap (roles and grants):**
- The SQL is idempotent and additive. It:
  - creates the migrator and app roles if they're missing
  - grants `rds_iam`
  - creates the `pensieve_meta` schema
  - sets ownership
  - grants the app role CRUD on tables and `USAGE` on sequences through `ALTER DEFAULT PRIVILEGES FOR ROLE <migrator>`
  - grants the app role `SELECT` on the bookkeeping table and `pensieve_meta`
- Removing a grant needs an explicit `REVOKE` added to the script, since re-running never removes anything by itself.
- **Local script:** `scripts/db-bootstrap.sh <db-sha>`, using the maintainer's SSO credentials. It:
  1. verifies the image signature with cosign
  2. registers a bootstrap task-definition revision on that image
  3. runs it with `aws ecs run-task` in the service's subnets and security group
  4. waits for exit code 0 and prints the CloudWatch log location
- **When:** once after the first `terraform apply`, and again whenever the bootstrap SQL changes. It isn't part of `deploy-db`.
- **Isolation:** the bootstrap task's role is the only principal that can read the RDS master secret. The `deploy-db` GitHub role has no `ecs:RunTask` on the bootstrap task definition and no `iam:PassRole` for its roles, so GitHub can't reach master power even indirectly.

**`db.yml` workflow:**
- Triggers: `pull_request` to `develop`/`main`, and `push` to `develop`/`main`, filtered with `on: paths:` to the database sources: `drizzle/**`, `db/**`, `src/db/**`, `certs/**`, `drizzle.config.ts`, `.dockerignore` and `db.yml`. Dependency bumps don't trigger it, since `ci.yml`'s `unit` job runs drizzle-orm's migrator on every change. Because a required check whose workflow never triggered blocks the PR, the `db.yml` jobs are **not** required checks in the rulesets. A failing run still shows on the PR, but doesn't block the merge on its own. (Revised twice. During ticket 38's reversal, a `changes` job and an aggregate `gate` were dropped in favour of every job running on every change and being required by name. During ticket 41, the maintainer chose the path filter instead, accepting that DB checks are advisory.)
- Jobs:
  - **db-drift:** runs `drizzle-kit generate` and fails if it produces any new file. It needs no database: drizzle-kit compares `schema.ts` with the committed snapshots in `drizzle/meta/`, not with the SQL, so the hand-added marker header doesn't affect it.
  - **db-image:** builds the DB image, then runs Trivy secret and vulnerability scans as spec 10 does for the app.
  - **db-apply:** using the built image against a `postgres:17-alpine` service:
    1. apply every migration to an empty database
    2. separately, apply the previous `main` commit's `drizzle/` with drizzle-kit
    3. run the image's migrator on top of that, with `ALLOW_BREAKING=true`, to exercise the upgrade path
  - **db-grants:** the Vitest grants test (below).
- **publish-db** (on every push to `main`, with `needs` listing every job above):
  - assumes the ECR push role via OIDC
  - pushes the scanned image as `sha-<short sha>` to `pensieve-db`
  - signs it keylessly with cosign
  - attaches its CycloneDX SBOM as an OCI 1.1 referrer, mirroring spec 12's app publish

**`deploy-db` workflow** (`workflow_dispatch`):
- **Inputs:**
  - `db_sha` (required)
  - `app_sha` (optional, required in practice for breaking migrations)
- **Environment:** `prod-db`, with the maintainer as required reviewer and deployment limited to `main`. It assumes the `deploy-db` OIDC role (spec 11), whose trust is limited to that environment.
- **Steps**, aborting on the first failure:
  1. Verify `sha-<db_sha>` with `cosign verify`, using the expected `main` workflow identity. If `app_sha` is given, verify that image too.
  2. Record the service's current task-definition revision and desired count.
  3. Scale the service to 0 and wait until no task is running.
  4. Take a manual snapshot named `pensieve-predeploy-<db_sha>-<timestamp>` and wait until it's available.
  5. Register a migrate task-definition revision on the DB image, with `ALLOW_BREAKING=true` only if `app_sha` was given. Run it as a one-off task and wait for exit code 0.
  6. If `app_sha` was given, register a new app task-definition revision for it (as `deploy-app` does) and point the service at it. Otherwise keep the recorded revision. Restore the recorded desired count and wait until the service is stable.
  7. Delete `pensieve-predeploy-*` snapshots other than the one just taken.
- **Failure path:** if step 5 fails, which includes a refused breaking migration, nothing was applied. The workflow restores the recorded revision and desired count before failing, so the outage ends there. The new snapshot is kept.
- If step 6 fails to stabilise with a new `app_sha`, the circuit breaker rolls back to the previous revision. With the startup check, that previous revision refuses a breaking schema and stays down. The run summary then points to the restore runbook (spec 12).

**Infrastructure touch-points** (owned by spec 11):
- the `pensieve-db` ECR repository
- the migrate and bootstrap task definitions on the DB image
- the bootstrap task role that can read the master secret
- the `deploy-db` OIDC role and its permissions
- the `prod-db` GitHub Environment

**Local development and app CI:** unchanged, `npm run db:migrate` (drizzle-kit). The app's e2e job migrates its throwaway Postgres this way (spec 10). The DB image is used only by DB CI and AWS.

## Testing Decisions

- **Good tests verify behaviour visible from outside:** what the migrator applies or refuses, what the startup check accepts or rejects, what a role can or can't do. Not how they're implemented.
- **Grants (Vitest database seam, moved from spec 11):** using the existing `createTestDb` harness:
  1. run the bootstrap SQL against the test database with a stub `rds_iam` role, since vanilla Postgres has none
  2. apply migrations as the migrator
  3. connect as the app role

  Then assert that the app role:
  - can select, insert, update and delete in a migrated table
  - is refused DDL
  - can still write a table the migrator creates *after* bootstrap
  - can read the bookkeeping table and `pensieve_meta`, but not write them
- **Migrator (Vitest database seam):** against a test database and a fixture migrations folder:
  - pending additive migrations apply
  - a pending breaking migration without `ALLOW_BREAKING` is refused, and nothing from the batch is applied
  - with `ALLOW_BREAKING` it applies and records its tag in `pensieve_meta.schema_compat`
- **Startup check (Vitest database seam):** given a journal and a database state, it accepts:
  - an exact match
  - a database ahead by only additive migrations

  It rejects:
  - a missing journal tag
  - a newer breaking migration
- **Upgrade path and drift:** covered by `db.yml`'s `db-apply` and `db-drift` jobs against real Postgres. They're not duplicated in Vitest.
- **`deploy-db` and the bootstrap script:** verified by real runs:
  - the first bootstrap
  - the first DB deploy
  - one deliberate breaking-migration window, tried first without `app_sha` to see the refusal and recovery, then with it
- **Prior art:** the existing `createTestDb`-based service tests and spec 11's original grants test design.

## Out of Scope

- **Zero-downtime deploys and full expand/contract discipline.** Breaking changes take a coordinated maintenance window instead.
- A separate repository or published schema package for the database.
- A migration linter (e.g. Squawk) to detect unmarked breaking migrations.
- Running the bootstrap from CI, or automatically on every DB deploy.
- A bastion host or SSM port forwarding to RDS.
- Automatic restore on a failed breaking window. Restore stays a manual runbook (spec 12).
- Down migrations. Rollback is a snapshot restore.
- Staging or preview databases.

## Further Notes

**Alternatives considered and rejected:**
- **DB-first, always compatible** (every migration must work with the running app, and breaking changes become expand → app release → contract across separate deploys). It gives full independence, but renames and drops would need three deploys. The maintainer chose the coordinated window, since downtime is acceptable.
- **SSM tunnel plus local `psql`/drizzle-kit** for migrations and bootstrap. It needs tunnel infrastructure, puts the master password on the laptop, and runs migrations from a local checkout rather than a verified artifact.
- **Keeping the migrator in the app image** with only a separate deploy script. It's the least change, but every app build stays a migration artifact.
- **Bootstrap on every DB deploy.** It would mean GitHub could launch the master-secret task.
- **A preflight `plan` task before downtime** to detect breaking migrations. The maintainer preferred enforcement inside the migrate step, accepting a few minutes of downtime when the coordinated window is forgotten.

**What's already built and changes:** the app image's `migrate.cjs` and bundled `drizzle/` (ticket 29) move to the DB image. App e2e (ticket 35) switches from the image's migrator to `npm run db:migrate`. Spec 10 records both as revisions.

This spec came out of a `grill-me` session revising specs 10–12. It also changed spec 10's required-check model to path-conditional jobs with one `gate` job per workflow. That change was built in ticket 38 and then reverted: every job runs on every change, and the rulesets require each job by name.
