# 54: `deploy-db` workflow (maintenance window)

**What to build:** Schema changes ship through one approved, dispatched workflow that runs the maintenance window and fails safe. `deploy-db` (`workflow_dispatch`, inputs `db_sha` required and `app_sha` optional) runs in the `prod-db` Environment with the `deploy-db` OIDC role. It verifies the signature(s) and records the service's revision and desired count. It scales to 0 and waits, then takes a `pensieve-predeploy-<db_sha>-<timestamp>` snapshot. It runs a migrate task on the DB image, with `ALLOW_BREAKING=true` only when `app_sha` was given. Then it starts the recorded revision, or a new revision for `app_sha`, and waits for stability, and finally deletes older pre-deploy snapshots. If migration fails or is refused, it restores the recorded revision and count before failing. Spec: `backlog/specs/13-database-lifecycle.md` (user stories 7, 8, 18–22; "`deploy-db` workflow").

**Blocked by:** 43 (breaking enforcement), 49 (migrate task definition and roles), 51 (signed DB images), 53 (roles must exist before the first migrate)

**Status:** ready-for-agent

- [ ] Dispatch-only, `prod-db` Environment (maintainer approval), OIDC `deploy-db` role; aborts on the first failed step
- [ ] `cosign verify` of the DB image, and of the app image when `app_sha` is given
- [ ] Records the current revision and desired count; scales to 0 and waits until no task runs
- [ ] Creates the named manual snapshot and waits until it's available
- [ ] Runs the migrate task on the DB image (`ALLOW_BREAKING=true` only with `app_sha`) and waits for exit code 0
- [ ] On migrate failure or refusal: restores the recorded revision and count, keeps the snapshot, and fails with a clear summary
- [ ] On success: starts the recorded revision (or a new one for `app_sha`), restores the count and waits for stability. On a failed stabilisation the summary points to the restore runbook
- [ ] Deletes `pensieve-predeploy-*` snapshots other than the one just taken
