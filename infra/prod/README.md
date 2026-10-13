# Prod config

Tickets 48, 49, 59 and 60 (spec 11). Production in eu-north-1, state in the
bootstrap config's bucket: the stateful and network foundation (48), the
compute and Cloudflare Tunnel ingress (49), and network (59) and database
(60) logging:

| File | What |
| --- | --- |
| `network.tf` | VPC; a public subnet holding only the NAT Gateway (and its Elastic IP); private subnets in two AZs (the task and RDS run in `eu-north-1a`; `-b` exists because an RDS subnet group needs two); an S3 gateway endpoint so image pulls skip the NAT |
| `security-groups.tf` | `pensieve-task` (no inbound at all, any outbound) and `pensieve-rds` (Postgres from `pensieve-task` only) |
| `database.tf` | RDS PostgreSQL 17, `db.t4g.micro`, single-AZ, 20→50 GB gp3, encrypted, IAM auth, RDS-managed master password (never in state), 35-day PITR, deletion protection, final snapshot, retained backups. Ticket 60: a parameter group with connection logging and pgaudit (`role`, `ddl`), and the `postgresql` and `iam-db-auth-error` logs exported to CloudWatch (30 days) |
| `registry.tf` | ECR `pensieve` and `pensieve-db`: immutable tags except `main`; keep the last 50 `sha-*`, expire untagged after a day |
| `observability.tf` | Log groups for the app, `cloudflared`, migrate and db-bootstrap (30 days); a monthly budget alerting at $10 actual and $20 forecast |
| `network-logs.tf` | Ticket 59: a flow log on the VPC (all traffic, with the fields that see through the NAT) and Resolver query logging, both delivered to the bootstrap config's log bucket (`vpc-flow/`, `resolver/`, kept 30 days) |
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
# The logging switches, from the same GitHub variables CI's plan reads
# ("Logging switches" below).
export TF_VAR_network_logs_enabled="$(gh variable get NETWORK_LOGS_ENABLED --env plan)"
export TF_VAR_db_log_exports_enabled="$(gh variable get DB_LOG_EXPORTS_ENABLED --env plan)"
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

## Logging switches

The logs billed by volume can be switched off without editing code or
changing anything by hand in AWS, which Terraform would see as drift. Each
switch is a Terraform variable with no default, set from a variable in the
`plan` GitHub Environment (Settings → Environments → plan), the one place
its value lives:

| GitHub variable | Terraform variable | Switches |
| --- | --- | --- |
| `NETWORK_LOGS_ENABLED` | `network_logs_enabled` | the VPC flow log and Resolver query logging (ticket 59) |
| `DB_LOG_EXPORTS_ENABLED` | `db_log_exports_enabled` | the RDS log exports to CloudWatch (ticket 60); the logging itself stays on the instance, so switching needs no reboot |

CI's plan passes them to Terraform, and the apply procedure above exports
them with `gh variable get`. To switch logs off: set the variable to
`false` (e.g. `gh variable set NETWORK_LOGS_ENABLED --env plan --body
false`), check the next PR's plan, then apply. What was already delivered
stays until it expires: the log bucket's lifecycle rules for the network
logs, the log groups' 30-day retention for the RDS exports. A missing or
empty variable fails the plan rather than falling back to either value.

## Investigating network traffic

Ticket 59. VPC flow logs and Resolver query logs land in the log bucket
within about 10 minutes, and the bootstrap config's `vpc_flow` and
`resolver` tables query them in Athena (workgroup `pensieve`, database
`pensieve_logs`), as the admin user. What the task sent out through the NAT,
with its real destination (on the NAT's interface, `srcaddr`/`dstaddr` are
the NAT's own addresses; `pkt_srcaddr`/`pkt_dstaddr` are the task's and the
real ones):

```sql
SELECT from_unixtime(start) AS at, pkt_srcaddr, pkt_dstaddr, dstport, bytes, action
FROM pensieve_logs.vpc_flow
WHERE year = 2026 AND month = 10 AND day = 13
  AND flow_direction = 'egress' AND pkt_dstaddr NOT LIKE '10.%'
ORDER BY bytes DESC
LIMIT 50;
```

Which domains anything in the VPC resolved (the VPC ID from
`aws ec2 describe-vpcs --filters Name=tag:Name,Values=pensieve`):

```sql
SELECT query_timestamp, srcaddr, query_name, query_type, rcode
FROM pensieve_logs.resolver
WHERE vpc = 'vpc-…' AND day >= '2026/10/13'
ORDER BY query_timestamp DESC
LIMIT 50;
```

## Database logging

Ticket 60. Postgres logs every connection and disconnection, and pgaudit
logs every role, grant and schema change (`pgaudit.log = 'role,ddl'`), in
the `postgresql` log. Failed IAM logins go to `iam-db-auth-error`. Both are
exported to CloudWatch (`/aws/rds/instance/pensieve/*`, 30 days).
Statements on rows are never logged (no `read` or `write` audit classes, no
`log_statement`), so note contents stay out of the logs.

Turning it on takes more than an apply. The apply attaches the parameter
group at once, but pgaudit (`shared_preload_libraries`, a static parameter)
only loads after a reboot: until then, `describe-db-instances` shows the
group `pending-reboot`. The extension itself is created by the DB
bootstrap, which fails until pgaudit is loaded. So, once:

```sh
terraform apply prod.tfplan    # the parameter group, log groups and exports
aws rds reboot-db-instance --db-instance-identifier pensieve   # a minute or two of downtime
aws rds wait db-instance-available --db-instance-identifier pensieve
scripts/db-bootstrap.sh <db-sha>   # creates the pgaudit extension
```

`describe-db-instances` should then show the group `in-sync`. To check it,
in CloudWatch Logs Insights over `/aws/rds/instance/pensieve/postgresql`:

```
fields @timestamp, @message
| filter @message like /AUDIT:|connection authorized|disconnection/
| sort @timestamp desc
| limit 50
```

## Bootstrapping the database

Ticket 53 (spec 13). The database roles and grants (`db/bootstrap.sql`) are
created by `scripts/db-bootstrap.sh`, run by hand as the admin user: once
after the first apply, then again whenever the bootstrap SQL changes (it's
idempotent). It runs the bootstrap as a one-off ECS task, so the master
password stays in AWS, and no GitHub role can run that task family or pass
its role. Needs cosign 3+ and jq; the argument is the `main` commit whose
release published the DB image (its `sha-<7>` tag in `pensieve-db`):

```sh
aws login --profile pensieve-admin
export AWS_PROFILE=pensieve-admin
scripts/db-bootstrap.sh <db-sha>
```

It verifies the image's signature (published by `db.yml` on `main`) before
touching ECS, registers a `pensieve-db-bootstrap` revision from the latest
one with only the image changed (pinned by digest; a re-run on the same
image reuses it), runs it in the service's subnet and security group, waits
for it to stop, and exits non-zero unless the container exited 0. Either way
it prints the task's log output and its CloudWatch log group and stream.

**The master's password login (ticket 62).** The first prod bootstrap left
the master holding the migrator's privileges, so RDS made it IAM-only and
every later run failed with `PAM authentication failed`. The bootstrap now
gives that membership up before committing. Recovering prod was a one-off,
run locally as the admin user and not kept in this repository. The admin
signs an IAM token for the master, which works while the master is IAM-only.
A temporary one-off task in the service's subnet, using `postgres:17-alpine`
and the bootstrap's execution role, runs the `REVOKE`, then checks the
password login. Don't run `db-bootstrap.sh` with an image older than this
fix: its SQL would lock the master out again.

## Deploying the database

Ticket 54 (spec 13). Migrations run only through the `deploy-db` workflow
(Actions → deploy-db → Run workflow, on `main`), which waits for your
approval in the `prod-db` Environment and then runs `scripts/deploy-db.sh`
as the `deploy-db` role. The role's ARN is the `prod-db` Environment's
`DEPLOY_DB_ROLE_ARN` variable (from `terraform output role_arns` in
`infra/bootstrap`).

- **Additive migration:** `db_sha` only. The app restarts on its current
  revision afterwards.
- **Breaking migration:** `db_sha` and `app_sha`, the app version that
  expects it. Without `app_sha` the migrator refuses a breaking migration,
  and the app comes back unchanged.

It verifies the image(s), records the service's revision and desired count,
scales it to 0, snapshots the database (`pensieve-predeploy-<db-sha>-<UTC
time>`), runs the migrator as a one-off task, then starts the app again at
the recorded count and deletes the older pre-deploy snapshots. A failed or
refused migration changes nothing and restores the app; if the app doesn't
stabilise after a migration, the run fails and points to the restore
runbook. If it gives up waiting for the migrator, which may still be
running, it leaves the app stopped: check the migrate log group, then start
the app with `deploy-app`. The first deploy's count is 0, so the app stays down until
`deploy-app` starts it. The run summary says what happened.

## Deploying the app

Ticket 52 (spec 12). App releases go through the `deploy-app` workflow
(Actions → deploy-app → Run workflow, on `main`), with `app_sha` the `main`
commit whose release published the image. It waits for your approval in the
`prod-app` Environment and runs `scripts/deploy-app.sh` as the `deploy-app`
role (ARN in that Environment's `DEPLOY_APP_ROLE_ARN` variable), which can't
touch the database.

It verifies the image, registers a `pensieve-app` revision from the latest
with only the app image changed, and points the service at it, at desired
count 1 on the first deploy, then waits until it's stable. Downtime is about
one Fargate cold start. If the new task never turns healthy (including the
startup schema check refusing a schema it can't run on), the circuit breaker
rolls back and the run fails with a link to the app log group. An app that
needs a schema change ships after `deploy-db`, or with it for a breaking
change (`deploy-db` with `app_sha`).

Both workflows run their script through `.github/actions/deploy` (assume
the role once, cosign as its pinned image) and share one concurrency group,
so two prod deploys never overlap.

`scripts/lib/deploy.sh` holds what the three scripts share
(verifying images, registering a revision from the family's latest with only
the image changed, running a one-off task, updating the service and checking
it settled). New
revisions carry no tags: the deploy roles may not tag.
