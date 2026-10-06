# 46: Terraform bootstrap config (state, OIDC, CI roles)

**What to build:** The chicken-and-egg pieces everything else depends on, created once from the maintainer's laptop with the `pensieve-admin` IAM user's `aws login` credentials. A small **bootstrap** Terraform root configuration (local state) creates the KMS-encrypted, versioned, public-access-blocked S3 state bucket with native lockfile locking, the GitHub OIDC identity provider, and four narrowly scoped roles: ECR push (`main` only, push to `pensieve` and `pensieve-db`), plan (`plan` Environment, read-only plus state read), `deploy-app` (`prod-app` Environment) and `deploy-db` (`prod-db` Environment). Resources are hand-written, one file per concern. Spec: `backlog/specs/11-aws-infrastructure.md` (user stories 1–7, 51; "Terraform layout and tooling", "Bootstrap config").

**Blocked by:** None (can start immediately)

**Status:** done

**Completed:** on `feat/46-terraform-patch-range` (implementation on `feat/46-terraform-bootstrap-config`)

**Pull Request:** https://github.com/sgspinola/pensieve/pull/32 (implementation), https://github.com/sgspinola/pensieve/pull/45 (admin-principal fix, completion)

- [x] Terraform pinned to a minor (`~> 1.16.0`, any patch) in `required_version`, exact version in a version file for CI; AWS provider pinned `~>` minor; `.terraform.lock.hcl` committed with darwin-arm64 and linux-arm64 checksums
- [x] State bucket: KMS encryption, versioning, public access blocked, bucket policy limited to the admin IAM user and the plan role; `use_lockfile` locking, no DynamoDB
- [x] GitHub OIDC provider, and an ECR push role trusted only from `main` of `sgspinola/pensieve`, limited to push to the two repositories
- [x] Plan role trusted only from the `plan` Environment, with AWS read-only access plus state bucket and lockfile read
- [x] `deploy-app` role trusted only from `prod-app` on `main`, with exactly spec 11's permissions (pull/describe `pensieve`, register app task definitions, update/describe the service, `PassRole` for the app roles only)
- [x] `deploy-db` role trusted only from `prod-db` on `main`, with exactly spec 11's permissions: migrate-family `RunTask` only, snapshot create/describe/tag, delete only `pensieve-predeploy-*`, migrate log read. No bootstrap family, roles or master secret; no RDS modify, restore or delete-instance
- [x] Applied locally by the maintainer (manual: `pensieve-admin` IAM user via `aws login`, `terraform apply`); the apply procedure is noted for the bootstrap runbook (ticket 56)

**Implementation notes:**
- `infra/bootstrap/`, one file per concern (`state.tf`, `oidc.tf`, one `iam-*.tf` per role); names prod must reuse are in `names.tf`. `terraform fmt`, `validate` and tflint pass (Terraform 1.16.5 via the `hashicorp/terraform` image).
- "On `main`" for the Environment-scoped deploy roles is enforced with the `token.actions.githubusercontent.com:ref` condition key (accepted by STS since January 2026), since an Environment job's `sub` carries no ref.
- Beyond the letter of spec 11, each justified in a comment: the ECR push role can read back what it pushed (cosign signs by digest), the plan role can read the tunnel-token secret (refreshing it in a plan needs `GetSecretValue`; the token is already in state), and `UpdateService` requires an app-family task definition.
- The apply procedure for the bootstrap runbook (ticket 56) is in `infra/bootstrap/README.md`.

