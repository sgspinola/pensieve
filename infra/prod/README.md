# Prod config

Ticket 48 (spec 11). Production in eu-north-1, state in the bootstrap
config's bucket. So far it holds the stateful and network foundation; ticket
49 adds compute and the Cloudflare Tunnel:

| File | What |
| --- | --- |
| `network.tf` | VPC; a public subnet holding only the NAT Gateway (and its Elastic IP); private subnets in two AZs (the task and RDS run in `eu-north-1a`; `-b` exists because an RDS subnet group needs two); an S3 gateway endpoint so image pulls skip the NAT |
| `security-groups.tf` | `pensieve-task` (no inbound at all, any outbound) and `pensieve-rds` (Postgres from `pensieve-task` only) |
| `database.tf` | RDS PostgreSQL 17, `db.t4g.micro`, single-AZ, 20→50 GB gp3, encrypted, IAM auth, RDS-managed master password (never in state), 35-day PITR, deletion protection, final snapshot, retained backups |
| `registry.tf` | ECR `pensieve` and `pensieve-db`: immutable tags except `main`; keep the last 50 `sha-*`, expire untagged after a day |
| `observability.tf` | Log groups for the app, `cloudflared`, migrate and db-bootstrap (30 days); a monthly budget alerting at $10 actual and $20 forecast |

Names the bootstrap config's CI roles are scoped to must match
`infra/bootstrap/names.tf` exactly (see `names.tf` here).

## Tests

`tests/foundation.tftest.hcl` checks the configuration against ticket 48's
checklist with a mocked AWS provider: no credentials, nothing created. CI's
`iac` job runs it.

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

```sh
aws login --profile pensieve-admin
export AWS_PROFILE=pensieve-admin
cd infra/prod
terraform init -backend-config="bucket=pensieve-tfstate-$(aws sts get-caller-identity --query Account --output text)"
terraform plan -out prod.tfplan   # review it
terraform apply prod.tfplan
```

The instance has deletion protection, and destroying it leaves a final
snapshot (`pensieve-final`) and the automated backups. Turn protection off in
code (a reviewed change) before anything can remove it.
