# 53: Local `db-bootstrap` script

**What to build:** The one master-powered step is a deliberate local act that never puts the master password on the maintainer's machine. A script taking a DB image SHA runs with the maintainer's SSO credentials. It verifies the image signature with cosign, registers a bootstrap task-definition revision on that image, runs it with `aws ecs run-task` in the service's subnets and security group, waits for exit code 0, and prints the CloudWatch log location. It's run once after the first prod apply and whenever the bootstrap SQL changes. Spec: `backlog/specs/13-database-lifecycle.md` (user stories 23–25; "Local script", "Isolation").

**Blocked by:** 42 (bootstrap entrypoint), 49 (bootstrap task definition and role), 51 (signed DB images)

**Status:** in-review: implemented on `feat/53-local-db-bootstrap-script`; the last item waits on the first real bootstrap (with ticket 56) and PR merge

- [x] Script verifies the DB image with `cosign verify` (expected `main` identity) before anything else
- [x] Registers a bootstrap revision on that image and runs it as a one-off task in the service's network config
- [x] Waits for the task to stop and exits non-zero unless the container exit code is 0, printing the log group and stream either way
- [x] Confirmed that no GitHub role can run the bootstrap family or pass its roles
- [ ] Verified by the first real bootstrap (with ticket 56), and a re-run that changes nothing (idempotent)

**Implementation notes:**
- `scripts/db-bootstrap.sh <db-sha>` (7–40 hex chars; the image tag is `sha-<first 7>`). It runs as the admin IAM user (`aws login --profile pensieve-admin`), not SSO; the spec's wording predates that. Region is fixed to `eu-north-1`; the account ID is read from `sts get-caller-identity`, never committed. Needs cosign 3+ (signatures are OCI 1.1 referrers) and jq. Usage is in `infra/prod/README.md` ("Bootstrapping the database").
- "Before anything else" means before any ECS call: it first needs read-only STS/ECR calls to resolve the tag to a digest and log cosign in to ECR (in a throwaway `DOCKER_CONFIG`, so the token doesn't linger in `~/.docker`). It verifies the digest against `https://github.com/sgspinola/pensieve/.github/workflows/db.yml@refs/heads/main` (issuer `https://token.actions.githubusercontent.com`), the identity `publish-db` signs with, then registers the digest-pinned reference.
- The new revision is built from the family's latest ACTIVE revision (not hand-written): describe-only fields are stripped, only the `db-bootstrap` container's image changes, and the revision's tags are carried over. If the latest revision already runs that exact digest, it's reused instead of registering a duplicate, so a re-run with the same SHA registers nothing.
- The network configuration comes from `describe-services` on `pensieve`, so no subnet or security group IDs are in the script. The log group and stream prefix come from the task definition (stream `<prefix>/db-bootstrap/<task ID>`). They're printed on success, on a non-zero or missing container exit code, and when `aws ecs wait tasks-stopped` gives up (about 10 minutes).
- Tests: `scripts/db-bootstrap.test.ts` runs the real script against stub `aws` and `cosign` executables on `PATH` that log their arguments and answer canned JSON. They cover the order (verify before any ECS call; a failed verify makes none), the exact registered definition, run-task's network config, exit codes and the printed log location. `vitest.config.ts` now includes `scripts/**/*.test.ts`. shellcheck passes (default checks); CI doesn't run shellcheck on standalone scripts.
- Isolation, checked statically against `infra/bootstrap/` (the four GitHub OIDC roles: `plan`, `ecr-push`, `deploy-app`, `deploy-db`):
  - `names.tf`: `task_families` lists only `pensieve-app` and `pensieve-migrate`, and `role_arns` is built only from the app and migrate roles. `db-bootstrap` appears in `infra/bootstrap/` only in that file's comment saying it's deliberately left out.
  - `iam-deploy-db.tf`: `ecs:RunTask` only on `task-definition/pensieve-migrate:*` (and only in the `pensieve` cluster). `ecs:RegisterTaskDefinition` only on the app and migrate families. `iam:PassRole` only on the app and migrate task and execution roles.
  - `iam-deploy-app.tf`: no `ecs:RunTask`. `RegisterTaskDefinition` only on the app family, and `iam:PassRole` only on the app roles. `UpdateService` only with an app-family task definition.
  - `iam-ecr-push.tf`: ECR actions only. `iam-plan.tf`: AWS `ReadOnlyAccess` (no `RunTask` or `PassRole`), plus the state bucket, its KMS key and the tunnel-token secret.
  - No GitHub role has an `ecs:*` or `iam:*` wildcard action. The prod roles (`infra/prod/iam.tf`) trust only `ecs-tasks.amazonaws.com`, and only the bootstrap execution role can read the master secret. So deploy-db can't get master power indirectly either: a migrate revision pointed at the master secret would need the bootstrap execution role, which it can't pass.
