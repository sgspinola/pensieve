# 52: `deploy-app` workflow

**What to build:** Releasing an app version is one approved, dispatched workflow that never touches the database. `deploy-app` (`workflow_dispatch`, input `app_sha`) runs in the `prod-app` Environment and assumes the `deploy-app` OIDC role. It confirms `sha-<app_sha>` exists and `cosign verify`s it against the `main` workflow identity. It then registers a new app task-definition revision with that image and updates the service, setting the desired count to 1 on the first deploy, and waits until the service is stable. Failures abort with a clear run-summary message linking the app log group. Spec: `backlog/specs/12-release-and-operations.md` (user stories 12–18, 20; "`deploy-app` workflow").

**Blocked by:** 40 (IAM connection in AWS), 44 (startup check as safety net), 49 (service and roles), 50 (signed published images)

**Status:** ready-for-agent

- [ ] Dispatch-only, `app_sha` required, `prod-app` Environment (maintainer approval), OIDC `deploy-app` role
- [ ] Missing tag or failed `cosign verify` aborts before anything changes
- [ ] Registers a new revision from the current one with only the image changed, updates the service, and sets desired count 1 if it's 0
- [ ] Waits for stability. On circuit-breaker rollback (including a startup check refusal) it fails with a summary linking the app log group
- [ ] Never calls Terraform, snapshots or migrates
- [ ] Verified by a real run (covered with the first deploy in ticket 56) and one deliberate run with an unsigned or tampered image that fails at `cosign verify`
