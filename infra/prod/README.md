# Prod config

Tickets 48 and 49 (spec 11). Production in eu-north-1, state in the
bootstrap config's bucket: the stateful and network foundation (48), and the
compute and Cloudflare Tunnel ingress (49):

| File | What |
| --- | --- |
| `network.tf` | VPC; a public subnet holding only the NAT Gateway (and its Elastic IP); private subnets in two AZs (the task and RDS run in `eu-north-1a`; `-b` exists because an RDS subnet group needs two); an S3 gateway endpoint so image pulls skip the NAT |
| `security-groups.tf` | `pensieve-task` (no inbound at all, any outbound) and `pensieve-rds` (Postgres from `pensieve-task` only) |
| `database.tf` | RDS PostgreSQL 17, `db.t4g.micro`, single-AZ, 20→50 GB gp3, encrypted, IAM auth, RDS-managed master password (never in state), 35-day PITR, deletion protection, final snapshot, retained backups |
| `registry.tf` | ECR `pensieve` and `pensieve-db`: immutable tags except `main`; keep the last 50 `sha-*`, expire untagged after a day |
| `observability.tf` | Log groups for the app, `cloudflared`, migrate and db-bootstrap (30 days); a monthly budget alerting at $10 actual and $20 forecast |
| `compute.tf` | ECS cluster and the one service (Fargate ARM64, 0.25 vCPU / 1 GB, desired count 0, 0%/100% deployments with circuit-breaker rollback, no load balancer); the first revisions of the app (app + `cloudflared` sidecar), migrate and db-bootstrap task definitions. The service ignores later task-definition and desired-count changes: the deploy workflows own them |
| `iam.tf` | Task and execution roles: the app task may `rds-db:connect` only as `pensieve_app`, migrate only as `pensieve_migrator`; only db-bootstrap's execution role reads the RDS master secret |
| `tunnel.tf` | Cloudflare: the tunnel, its ingress (`pensieve.fyi` → `http://localhost:3000`), the proxied apex CNAME and Full (strict) SSL; the tunnel token, built from a Terraform-generated tunnel secret and stored in Secrets Manager for the sidecar |

Names the bootstrap config's CI roles are scoped to must match
`infra/bootstrap/names.tf` exactly (see `names.tf` here).

## Tests

`tests/*.tftest.hcl` check the configuration against tickets 48
(`foundation`) and 49 (`compute`, `ingress`) with mocked AWS and Cloudflare
providers: no credentials, nothing created. The mocks' shared defaults are in
`tests/mocks/`. CI's `iac` job runs them.

```sh
cd infra/prod
terraform init -backend=false
terraform test
```

## Applying it

As the admin user (see `infra/bootstrap/README.md`, step 1), after the
bootstrap config is applied. The budget's email address isn't committed:
put `budget_email = "<you>"` in `infra/prod/terraform.tfvars` (git-ignored),
and the same address in the `plan` Environment's `BUDGET_EMAIL` secret so
CI's plan has it (a secret, not a variable, so the run log masks it).

The Cloudflare provider reads `CLOUDFLARE_API_TOKEN`. For applies, create a
token (Cloudflare dashboard, My Profile → API Tokens) scoped to the
`pensieve.fyi` zone and its account, with Zone: Read, DNS: Edit and Zone
Settings: Edit on the zone, and Account: Cloudflare Tunnel: Edit. Keep it out
of the repository and your shell history (e.g. in a password manager). CI's
plan uses its own read-only token, the `plan` Environment's
`CLOUDFLARE_API_TOKEN` secret: Zone: Read, DNS: Read and Zone Settings: Read
on the zone, and Account: Cloudflare Tunnel: Read. (Nothing in this config
reads the token back from Cloudflare, which would need Tunnel Write.)

```sh
aws login --profile pensieve-admin
export AWS_PROFILE=pensieve-admin
read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
cd infra/prod
terraform init -backend-config="bucket=pensieve-tfstate-$(aws sts get-caller-identity --query Account --output text)"
terraform plan -out prod.tfplan   # review it
terraform apply prod.tfplan
```

The service starts at 0 tasks: nothing runs until the first `deploy-app`
(ticket 52), after the DB bootstrap and first `deploy-db` (tickets 53, 54).
The tunnel token is sensitive, so plans print `(sensitive value)` for it; it
lives in state and in the `pensieve/cloudflared-tunnel-token` secret.

The instance has deletion protection, and destroying it leaves a final
snapshot (`pensieve-final`) and the automated backups. Turn protection off in
code (a reviewed change) before anything can remove it.
