# 49: Prod compute and Cloudflare Tunnel ingress

**What to build:** The app's runtime and its only way in. An ECS Fargate (ARM64) cluster and service run the app plus a `cloudflared` sidecar in the private subnet, with no load balancer and no inbound port. The service starts at desired count 0, uses minimum healthy 0% / maximum 100% with circuit-breaker rollback, and ignores later changes to its task definition and desired count so the deploy workflows own them. Terraform creates the initial app, migrate and db-bootstrap task definitions with least-privilege task and execution roles. Through the Cloudflare provider it creates the tunnel, its ingress config, the `pensieve.fyi` apex DNS record and Full (strict) SSL. The tunnel token is kept sensitive and passed to the sidecar via Secrets Manager. Spec: `backlog/specs/11-aws-infrastructure.md` (user stories 14–17, 20, 24, 25, 34, 35, 37, 42–44, 50, 52; "Ingress", "Compute", the task bullets under "Database").

**Blocked by:** 48 (network, RDS, ECR, log groups)

**Status:** ready-for-agent

- [ ] ECS cluster and one service: Fargate ARM64, 0.25 vCPU / 1 GB, desired count 0, deployment 0%/100% with circuit-breaker rollback, `ignore_changes` on task definition and desired count
- [ ] App task definition: app + `cloudflared` sidecar, health check via the image's Node health script, `awslogs` to the right log groups, WebAuthn RP ID `pensieve.fyi` and origin `https://pensieve.fyi`, and IAM DB connection env vars (ticket 40)
- [ ] Migrate and db-bootstrap task definitions on the DB image
- [ ] Task roles: app may `rds-db:connect` only as the app user; migrate only as the migrator user. Only the bootstrap task role can read the RDS master secret
- [ ] Cloudflare tunnel, ingress config and apex DNS record for `pensieve.fyi`, Full (strict) SSL. Every attribute or output carrying the tunnel token is sensitive; the token reaches the sidecar via Secrets Manager
- [ ] Manual: the maintainer provides a Cloudflare API token for local applies and creates the `prod-app` and `prod-db` Environments (required reviewer, `main` only)
- [ ] CI plan shows no secret values; applied by the maintainer with the service at 0 tasks
