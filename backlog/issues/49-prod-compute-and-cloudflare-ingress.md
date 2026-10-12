# 49: Prod compute and Cloudflare Tunnel ingress

**What to build:** The app's runtime and its only way in. An ECS Fargate (ARM64) cluster and service run the app plus a `cloudflared` sidecar in the private subnet, with no load balancer and no inbound port. The service starts at desired count 0, uses minimum healthy 0% / maximum 100% with circuit-breaker rollback, and ignores later changes to its task definition and desired count so the deploy workflows own them. Terraform creates the initial app, migrate and db-bootstrap task definitions with least-privilege task and execution roles. Through the Cloudflare provider it creates the tunnel, its ingress config, the `pensieve.fyi` apex DNS record and Full (strict) SSL. The tunnel token is kept sensitive and passed to the sidecar via Secrets Manager. Spec: `backlog/specs/11-aws-infrastructure.md` (user stories 14–17, 20, 24, 25, 34, 35, 37, 42–44, 50, 52; "Ingress", "Compute", the task bullets under "Database").

**Blocked by:** 48 (network, RDS, ECR, log groups)

**Status:** in-review

**Pull Request:** https://github.com/sgspinola/pensieve/pull/71

- [x] ECS cluster and one service: Fargate ARM64, 0.25 vCPU / 1 GB, desired count 0, deployment 0%/100% with circuit-breaker rollback, `ignore_changes` on task definition and desired count
- [x] App task definition: app + `cloudflared` sidecar, health check via the image's Node health script, `awslogs` to the right log groups, WebAuthn RP ID `pensieve.fyi` and origin `https://pensieve.fyi`, and IAM DB connection env vars (ticket 40)
- [x] Migrate and db-bootstrap task definitions on the DB image
- [x] Task roles: app may `rds-db:connect` only as the app user; migrate only as the migrator user. Only the bootstrap ~~task role~~ family's execution role can read the RDS master secret (revised: ECS injects `secrets` with the execution role; see spec 11, "Database")
- [x] Cloudflare tunnel, ingress config and apex DNS record for `pensieve.fyi`, Full (strict) SSL. Every attribute or output carrying the tunnel token is sensitive; the token reaches the sidecar via Secrets Manager
- [x] Manual: the maintainer creates the `prod-app` and `prod-db` Environments (required reviewer, `main` only). Verified with `gh api`: both require the maintainer's review and allow only the `main` branch. CI's plan token already has the read permissions it needs
- [x] Manual: the maintainer provides a Cloudflare API token for local applies (permissions in `infra/prod/README.md`)
- [x] CI plan shows no secret values; applied by the maintainer with the service at 0 tasks. Applied (22 added, nothing changed or destroyed). The service is `ACTIVE` at 0 desired and 0 running on `pensieve-app:1`. PR #71's `iac` plan ran with the read-only token and reported no changes
- [ ] First successful app→RDS connection (with the first deploy), which also proves ticket 48's in-VPC reachability: then tick 48's last item, mark it `done` and archive it in this ticket's PR

**Implementation notes:**
- New files in `infra/prod`: `compute.tf` (cluster, service, three task definitions), `iam.tf` (task and execution roles), `tunnel.tf` (Cloudflare and the token secret). Shared names in `names.tf` match `infra/bootstrap/names.tf`. The db-bootstrap family and its role (`pensieve-db-bootstrap*`) are deliberately absent there.
- `tests/compute.tftest.hcl` and `tests/ingress.tftest.hcl` cover the checklist against mocked AWS and Cloudflare providers. Shared mock defaults are in `tests/mocks/`, which `foundation.tftest.hcl` now uses too. `ignore_changes` can't be seen by a test; the first deploy after an apply proves it.
- Policies are `jsonencode()`d rather than `aws_iam_policy_document`, so the tests can read them under the mock.
- Tunnel token: Terraform generates the tunnel secret (`random_bytes`) and builds the token itself. Reading a Cloudflare-generated token back needs Tunnel Write, which CI's read-only plan token lacks. The plan token needs Zone, DNS, Zone Settings and Tunnel **Read** (see `infra/prod/README.md`).
- The first task-definition revisions use each repository's moving `main` tag. That's safe because the service starts at 0 tasks, and every deploy registers a `sha-*` revision. Later Terraform changes to a task definition (env vars, roles) create a new revision that the service ignores. So the deploy workflows (52, 54) must register from the *family's latest* revision, not the service's current one, to pick those changes up.
- `cloudflared` runs `cloudflare/cloudflared:2026.10.0`, pinned by index digest and pulled from Docker Hub through the NAT. It starts only once the app container is `HEALTHY`.
- The app container sets `HOSTNAME=0.0.0.0` explicitly (the image does too), so Next.js always listens on localhost for the sidecar and the health check.
