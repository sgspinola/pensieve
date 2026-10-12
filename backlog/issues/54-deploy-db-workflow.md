# 54: `deploy-db` workflow (maintenance window)

**What to build:** Schema changes ship through one approved, dispatched workflow that runs the maintenance window and fails safe. `deploy-db` (`workflow_dispatch`, inputs `db_sha` required and `app_sha` optional) runs in the `prod-db` Environment with the `deploy-db` OIDC role. It verifies the signature(s) and records the service's revision and desired count. It scales to 0 and waits, then takes a `pensieve-predeploy-<db_sha>-<timestamp>` snapshot. It runs a migrate task on the DB image, with `ALLOW_BREAKING=true` only when `app_sha` was given. Then it starts the recorded revision, or a new revision for `app_sha`, and waits for stability, and finally deletes older pre-deploy snapshots. If migration fails or is refused, it restores the recorded revision and count before failing. Spec: `backlog/specs/13-database-lifecycle.md` (user stories 7, 8, 18–22; "`deploy-db` workflow").

**Blocked by:** 43 (breaking enforcement), 49 (migrate task definition and roles), 51 (signed DB images), 53 (roles must exist before the first migrate)

**Status:** in-review

- [x] Dispatch-only, `prod-db` Environment (maintainer approval), OIDC `deploy-db` role; aborts on the first failed step
- [x] `cosign verify` of the DB image, and of the app image when `app_sha` is given
- [x] Records the current revision and desired count; scales to 0 and waits until no task runs
- [x] Creates the named manual snapshot and waits until it's available
- [x] Runs the migrate task on the DB image (`ALLOW_BREAKING=true` only with `app_sha`) and waits for exit code 0
- [x] On migrate failure or refusal: restores the recorded revision and count, keeps the snapshot, and fails with a clear summary
- [x] On success: starts the recorded revision (or a new one for `app_sha`), restores the count and waits for stability. On a failed stabilisation the summary points to the restore runbook
- [x] Deletes `pensieve-predeploy-*` snapshots other than the one just taken
- [x] Manual: the `prod-db` Environment has a `DEPLOY_DB_ROLE_ARN` variable (`terraform output role_arns` in `infra/bootstrap`, `deploy_db`)
- [ ] Verified by the first real run (with ticket 56), and a deliberate breaking migration dispatched without `app_sha` that's refused and leaves the app running. First real run: done on 2026-10-12 (`sha-3a0ad38`, run 38296935904: snapshot `pensieve-predeploy-3a0ad38-20261012192302`, `pensieve-migrate:2` with `ALLOW_BREAKING=false` printed "Migrations applied", and the service stayed at 0 tasks for the first deploy). The refused-breaking-migration run is still to do

**Implementation notes:**
- The workflow (`.github/workflows/deploy-db.yml`) only authenticates and calls `scripts/deploy-db.sh` (since ticket 52, through `.github/actions/deploy`, shared with deploy-app), which does the window. It assumes the role once for an hour with `assume-role-with-web-identity` (GitHub's OIDC token lasts about five minutes). cosign runs as its pinned image behind a `cosign` shim on PATH. It shares the `prod-deploy` concurrency group with deploy-app (52), never cancelling.
- `scripts/lib/deploy.sh` holds what this, `db-bootstrap.sh` (refactored onto it) and deploy-app (52) share: verifying an image by digest, registering a revision from the family's latest with only one container's image changed (no tags: the deploy roles may not tag), running a one-off task in the service's network config, and updating the service. Updating the service checks the result: the primary deployment is the requested revision, completed, at the requested running count. A circuit-breaker rollback or a failed update fails the step. It's bash 3.2 compatible, because macOS's `/bin/bash` runs `db-bootstrap.sh`.
- `ALLOW_BREAKING` is always set explicitly (`true` only with `app_sha`): revisions are made from the family's latest, which may be a breaking deploy's.
- Failure handling: anything failing between scaling to 0 and a successful migration restores the recorded revision and count, keeping the snapshot. If the wait for the migrator gives up, its outcome is unknown, so the app stays stopped and the run says so. A failure after the migration points to the restore runbook (ticket 57). A run killed by the job timeout (55 minutes, inside the role session's hour) skips the restore; the summary shows how far it got.
- Tests: `scripts/deploy-db.test.ts` (22) runs the script against stub `aws`/`cosign` (`scripts/test-support/stub-cli.ts`, shared with `db-bootstrap.test.ts`). The cosign shim was exercised locally against the pinned cosign image.
