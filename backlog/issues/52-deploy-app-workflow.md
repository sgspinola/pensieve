# 52: `deploy-app` workflow

**What to build:** Releasing an app version is one approved, dispatched workflow that never touches the database. `deploy-app` (`workflow_dispatch`, input `app_sha`) runs in the `prod-app` Environment and assumes the `deploy-app` OIDC role. It confirms `sha-<app_sha>` exists and `cosign verify`s it against the `main` workflow identity. It then registers a new app task-definition revision with that image and updates the service, setting the desired count to 1 on the first deploy, and waits until the service is stable. Failures abort with a clear run-summary message linking the app log group. Spec: `backlog/specs/12-release-and-operations.md` (user stories 12–18, 20; "`deploy-app` workflow").

**Blocked by:** 40 (IAM connection in AWS), 44 (startup check as safety net), 49 (service and roles), 50 (signed published images)

**Status:** in-review

- [x] Dispatch-only, `app_sha` required, `prod-app` Environment (maintainer approval), OIDC `deploy-app` role
- [x] Missing tag or failed `cosign verify` aborts before anything changes
- [x] Registers a new revision from the ~~current one~~ family's latest (so Terraform's own task-definition changes aren't lost; see ticket 49) with only the image changed, updates the service, and sets desired count 1 if it's 0
- [x] Waits for stability. On circuit-breaker rollback (including a startup check refusal) it fails with a summary linking the app log group
- [x] Never calls Terraform, snapshots or migrates
- [ ] Verified by a real run (covered with the first deploy in ticket 56) and one deliberate run with an unsigned or tampered image that fails at `cosign verify`. Real run: done on 2026-10-12 (`sha-3a0ad38`, run 38299231421: `pensieve-app:2` at 1 task, rollout completed, the app live at `https://pensieve.fyi`). The tampered-image run is still to do
- [x] Manual: the `prod-app` Environment has a `DEPLOY_APP_ROLE_ARN` variable (checked against `terraform output role_arns`)

**Implementation notes:**
- `.github/workflows/deploy-app.yml` checks out and runs `scripts/deploy-app.sh` through `.github/actions/deploy`. That action is now shared with deploy-db: it assumes the role once for an hour and puts cosign, as its pinned image, behind a `cosign` shim on PATH. Both workflows share the `prod-deploy` concurrency group and never cancel.
- The script is a few calls into `scripts/lib/deploy.sh` (ticket 54): verify by digest against `ci.yml` on main, register from the family's latest with only the `app` container's image changed (the `cloudflared` sidecar untouched), and update the service at its desired count, or 1 when it's 0. Updating fails unless the service settles on that revision at that running count with the rollout completed, so a circuit-breaker rollback fails the run. The summary links the app log group in the CloudWatch console.
- The deploy-app role has no RDS, RunTask or migrate-family permissions, so "never snapshots or migrates" is enforced by IAM too. A test asserts the script makes no such call.
- Waiting polls the service's own deployment (`scripts/lib/deploy.sh` `update_service`, up to 20 minutes) instead of the `services-stable` waiter, which gives up after 10. The circuit breaker needs a few failed tasks, minutes each, before it fails a rollout, and the waiter would have stopped first. The run fails as soon as the deployment is marked failed or replaced. This also changes deploy-db's waits.
- The composite action takes the SHAs as separate inputs (`sha`, `app-sha`), so deploy-db's two inputs can't run together into one value.
- Tests: `scripts/deploy-app.test.ts` (12) against stub `aws`/`cosign`.
