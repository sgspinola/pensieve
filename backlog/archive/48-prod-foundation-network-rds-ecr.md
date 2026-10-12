# 48: Prod foundation: network, RDS, ECR, logs, budgets

**What to build:** The stateful and network foundation of production in eu-north-1, in the **prod** root configuration with its state in the bootstrap bucket. It provisions a VPC with subnets in two AZs, a private subnet for the task, a single NAT Gateway, and an S3 gateway endpoint. It also provisions the RDS and task security groups, and RDS PostgreSQL 17 (`db.t4g.micro`, single-AZ, 20→50 GB gp3, IAM auth, RDS-managed master password, 35-day point-in-time recovery, deletion protection, final snapshot, retained backups, encrypted, night backup window). Rounding it out: the `pensieve` and `pensieve-db` ECR repositories, CloudWatch log groups, and AWS Budgets alerts. Spec: `backlog/specs/11-aws-infrastructure.md` (user stories 18, 19, 21–23, 26–31, 45–49; "Network", "Database", "Registry", "Observability and cost").

**Blocked by:** 47 (CI plan on infrastructure PRs), 58 (audit trail, so prod's first apply is recorded)

**Status:** done

**Completed:** on `feat/48-prod-foundation-network-rds-ecr`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/62

- [x] VPC with two-AZ subnets, a private task subnet, a single NAT Gateway + EIP, and an S3 gateway endpoint
- [x] RDS security group accepts Postgres only from the task security group; the task security group allows no inbound traffic
- [x] RDS instance configured exactly as spec 11 lists, with the master password never in state
- [x] Both ECR repositories with immutable tags (or immutable-with-exclusions for a moving `main` tag, if the pinned provider supports it, per spec 12) and lifecycle rules: keep the last 50 `sha-*` (`tagPatternList`), expire untagged after 1 day, no archive tier (spec 11: the running image can be several releases old)
- [x] Log groups for app, `cloudflared`, migrate and db-bootstrap, with 30-day retention
- [x] Monthly budget with notifications at $10 actual and $20 forecast to the maintainer
- [x] CI plan is clean on the PR (the first real run of ticket 47's plan path: OIDC as the plan role, the Cloudflare token, and the plan in the run summary); applied by the maintainer, and the instance is reachable from inside the VPC only

**Implementation notes:**

- The config is in `infra/prod/`, one file per concern; see its README for the layout and how to apply it. The task and RDS both run in `eu-north-1a`. The second private subnet exists only because an RDS subnet group needs two AZs. The VPC's default security group is locked down (no rules).
- Ticket 48 added the TDD seam: `infra/prod/tests/foundation.tftest.hcl` checks each checklist item against a mocked AWS provider. CI's `iac` job runs it in a new `terraform test` step. Spec 11's Testing Decisions are revised to match.
- Nothing account-specific is committed. The backend's bucket name, which contains the account ID, is passed at init: CI derives it from `PLAN_ROLE_ARN`, and the README gives the local command. The budget email is a sensitive Terraform variable: locally it comes from a git-ignored `terraform.tfvars`, and in CI from the `plan` Environment's **`BUDGET_EMAIL` secret**. It has to be a secret, because GitHub would print a variable in the run log.
- ECR uses `IMMUTABLE_WITH_EXCLUSION` with a `main` wildcard filter, which provider 6.67 supports, so spec 12's moving `main` tag stays.
- Dependabot's Terraform entry now lists `/infra/bootstrap` and `/infra/prod`. Before, it pointed at `/infra`, which isn't a root config.
- Manual before the PR's plan can pass: add the `BUDGET_EMAIL` secret to the `plan` Environment.

**In-VPC reachability (last item):** as the maintainer chose, proven by the first real deploy rather than a Reachability Analyzer probe. On 2026-10-12, the `db-bootstrap` task (as the master) and the `deploy-db` migrate task (as `pensieve_migrator`, IAM) reached the instance from the private subnet. The app (`pensieve-app:2`, as `pensieve_app`, IAM) then passed its startup schema check against it ("Database schema is compatible with this app"). From the internet, the endpoint resolves to a private IP and times out (checked at apply).
