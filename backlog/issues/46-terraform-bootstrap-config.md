# 46: Terraform bootstrap config (state, OIDC, CI roles)

**What to build:** The chicken-and-egg pieces everything else depends on, created once from the maintainer's laptop with IAM Identity Center credentials. A small **bootstrap** Terraform root configuration (local state) creates the KMS-encrypted, versioned, public-access-blocked S3 state bucket with native lockfile locking, the GitHub OIDC identity provider, and four narrowly scoped roles: ECR push (`main` only, push to `pensieve` and `pensieve-db`), plan (`plan` Environment, read-only plus state read), `deploy-app` (`prod-app` Environment) and `deploy-db` (`prod-db` Environment). Resources are hand-written, one file per concern. Spec: `backlog/specs/11-aws-infrastructure.md` (user stories 1–7, 51; "Terraform layout and tooling", "Bootstrap config").

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Exact Terraform version pinned in `required_version` and a version file; AWS provider pinned `~>` minor; `.terraform.lock.hcl` committed with darwin-arm64 and linux-arm64 checksums
- [ ] State bucket: KMS encryption, versioning, public access blocked, bucket policy limited to the admin and plan roles; `use_lockfile` locking, no DynamoDB
- [ ] GitHub OIDC provider, and an ECR push role trusted only from `main` of `sgspinola/pensieve`, limited to push to the two repositories
- [ ] Plan role trusted only from the `plan` Environment, with AWS read-only access plus state bucket and lockfile read
- [ ] `deploy-app` role trusted only from `prod-app` on `main`, with exactly spec 11's permissions (pull/describe `pensieve`, register app task definitions, update/describe the service, `PassRole` for the app roles only)
- [ ] `deploy-db` role trusted only from `prod-db` on `main`, with exactly spec 11's permissions: migrate-family `RunTask` only, snapshot create/describe/tag, delete only `pensieve-predeploy-*`, migrate log read. No bootstrap family, roles or master secret; no RDS modify, restore or delete-instance
- [ ] Applied locally by the maintainer (manual: Identity Center admin user, `terraform apply`); the apply procedure is noted for the bootstrap runbook (ticket 56)
