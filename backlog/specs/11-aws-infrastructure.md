# 11: AWS infrastructure as code (ECS Fargate, RDS, Cloudflare Tunnel)

## Problem Statement

Pensieve has no place to run. The AWS account intended for it is empty, there's no infrastructure code, and the only deployment-related decisions so far (the WebAuthn relying-party variables in the README, the logging spec's assumption of "stdout ingested by a platform log driver") were deliberately deferred until a target existed. The maintainer wants the app running on AWS ECS with RDS PostgreSQL, provisioned entirely through Terraform so the environment is reproducible and reviewable, behind the `pensieve.fyi` domain they already own at Cloudflare, at a cost appropriate for a one-to-two-user personal app.

Several constraints shape this:
- **Passkeys bind to the domain permanently.** The WebAuthn RP ID can't change once real passkeys are registered, so the domain, TLS and origin decisions have to be right from day one.
- **The database must not be reachable from the internet**, and the application should connect with the least privilege it needs. The maintainer explicitly doesn't want the RDS master credential used by the app.
- **Only Cloudflare should be able to reach the origin.**
- **The maintainer is new to Terraform**, so the layout has to stay legible, with every resource visible rather than hidden inside large community modules.
- **The repository is public**, so infrastructure code, CI logs and artifacts are public too, and secrets must never land in any of them.

## Solution

Terraform in two root configurations:
- A tiny **bootstrap** config, applied once from the maintainer's laptop, creates what everything else depends on: an encrypted, versioned S3 state bucket with native lockfile locking, the GitHub OIDC identity provider, and two narrowly scoped CI roles (ECR push, read-only plan).
- The main **prod** config, in eu-north-1 (Stockholm, the cheapest EU region for this stack), stores its state in that bucket and provisions:
  - a VPC with the app task in a private subnet behind a NAT Gateway
  - a single-AZ RDS PostgreSQL 17 instance with 35-day point-in-time recovery and deletion protection
  - an ECS Fargate (arm64) service running the app plus a `cloudflared` sidecar
  - an ECR repository
  - CloudWatch log groups
  - AWS Budgets alerts
  - and, through the Cloudflare provider, the Tunnel and DNS for `pensieve.fyi`

There's **no load balancer and no inbound port at all**. The `cloudflared` sidecar dials out to Cloudflare, so the origin is unreachable from the internet by construction, which is a stronger guarantee than mTLS between Cloudflare and an ALB, and about $25/month cheaper.

The app authenticates to Postgres with **RDS IAM authentication**: short-lived tokens signed with the task's IAM role, so no database password exists in the app task. A dedicated migrator role owns the schema; the app role can only read and write rows. A one-off bootstrap task, the only thing allowed to read the RDS-managed master secret, creates those roles once. The app refuses to start if its bundled migrations haven't all been applied.

CI gains Terraform formatting, validation, linting and a read-only `plan` on pull requests, carefully arranged so that no secret (in particular the tunnel token held in state) can leak into public logs or artifacts.

## User Stories

1. As the maintainer, I want all AWS and Cloudflare infrastructure defined in Terraform, so that the environment is reproducible and every change is reviewable as code.
2. As the maintainer, I want Terraform state stored remotely in S3 with versioning, encryption and locking, so that state isn't lost with my laptop, can be recovered after corruption, and two applies can't collide.
3. As the maintainer, I want the state bucket and CI identity created by a separate, one-off bootstrap config, so that the chicken-and-egg problem (state bucket, CI auth) is solved once and explicitly.
4. As the maintainer, I want to apply the bootstrap locally with my own credentials, so that CI never holds the power to create its own identity.
5. As the maintainer, I want to use IAM Identity Center rather than root access keys, so that my local AWS access is short-lived and auditable.
6. As the maintainer, I want resources hand-written rather than wrapped in community modules, so that, being new to Terraform, I can see and understand everything that exists.
7. As the maintainer, I want exact Terraform and pinned provider versions with a committed lockfile, so that plans are reproducible across my laptop and CI.
8. As the maintainer, I want Dependabot to propose Terraform provider updates, so that pinning doesn't mean falling behind.
9. As the maintainer, I want every PR that touches infrastructure to show a Terraform plan, so that I see what will change before I apply it.
10. As the maintainer, I want CI's plan to use a read-only AWS role and a read-only Cloudflare token, so that a compromised CI run can't change infrastructure.
11. As the maintainer, I want the plan job to run only for PRs from this repository (never forks), so that outside code never gets AWS or Cloudflare credentials.
12. As the maintainer, I want no plan file uploaded as an artifact and no Terraform debug logging in CI, so that sensitive state values can't leak through public artifacts or logs.
13. As the maintainer, I want CI's Terraform checks to include formatting, validation and tflint with the AWS ruleset, so that broken or non-idiomatic infrastructure code is caught before review.
14. As the maintainer, I want the app reachable at `https://pensieve.fyi`, so that it has a stable, permanent home.
15. As the maintainer, I want the WebAuthn RP ID set to `pensieve.fyi`, so that passkeys keep working even if the app later moves to a subdomain.
16. As the maintainer, I want only Cloudflare to be able to reach my origin, so that the app can't be attacked directly, bypassing Cloudflare.
17. As the maintainer, I want the origin to have no inbound ports at all, so that a security-group mistake can't expose it.
18. As the maintainer, I want the app task in a private subnet with no public address, so that even outbound-only exposure is minimised.
19. As the maintainer, I want image pulls routed through a free S3 gateway endpoint, so that they don't add NAT data-processing charges.
20. As the maintainer, I want the Cloudflare DNS, tunnel and SSL settings managed by Terraform, so that wiring Cloudflare to AWS needs no manual copy-paste of IDs.
21. As the maintainer, I want the cheapest EU region, so that the fixed monthly cost is as low as possible.
22. As the maintainer, I want only a production environment, so that I don't pay twice for a personal app.
23. As the maintainer, I want the instances in a single Availability Zone, so that I'm not paying for redundancy a one-to-two-user app doesn't need.
24. As the maintainer, I want the app on arm64 Fargate, so that I get Graviton's lower price now that native arm64 CI runners are free.
25. As the maintainer, I want the smallest sensible task size, so that compute cost matches actual load.
26. As the maintainer, I want the database on the smallest Graviton RDS instance with storage autoscaling, so that it's cheap now but won't run out of space.
27. As the maintainer, I want 35 days of point-in-time recovery, so that I can restore to any second in the last five weeks at no extra cost at this data size.
28. As the maintainer, I want deletion protection, a final snapshot on delete, and automated backups retained after deletion, so that no single mistake, including `terraform destroy`, loses my data.
29. As the maintainer, I want the database and all backups encrypted, so that data at rest is protected.
30. As the maintainer, I want the backup window at night, so that the brief I/O pause of a single-AZ snapshot doesn't affect me.
31. As the maintainer, I want the RDS master password generated and rotated by RDS itself, so that it never appears in Terraform state or code.
32. As the maintainer, I want the app to connect with an IAM-authenticated database user, so that no database password exists in the app task at all.
33. As the maintainer, I want the app's database user to be limited to reading and writing rows, so that a compromised app can't alter or drop the schema.
34. As the maintainer, I want a separate migrator user that owns the schema, so that DDL rights exist only in the migration task.
35. As the maintainer, I want each task's IAM role able to log in only as its own database user, so that the app task can't impersonate the migrator.
36. As the maintainer, I want new tables automatically granted to the app user, so that a new migration can't silently break the app with a missing grant.
37. As the maintainer, I want the master credential used only by a one-off database bootstrap task, so that routine tasks never hold it.
38. As the maintainer, I want the database bootstrap to be idempotent, so that I can re-run it safely if roles or grants change.
39. As a developer, I want local development and CI to keep using a plain `DATABASE_URL`, so that IAM authentication doesn't complicate anything outside AWS.
40. As an operator, I want database connections to RDS encrypted and verified against the RDS certificate authority, so that IAM auth's TLS requirement is met properly.
41. As an operator, I want the app to refuse to start when its bundled migrations haven't all been applied, so that a deploy that skipped migrating fails fast instead of running against the wrong schema.
42. As an operator, I want ECS to roll back automatically when a new task fails to become healthy, so that a bad deploy doesn't leave the app down.
43. As an operator, I want the old and new app versions never to run at the same time, so that a migration only ever has to be compatible with one version.
44. As an operator, I want container health judged by the app's health endpoint, so that ECS replaces a task whose database connection is broken.
45. As an operator, I want app, sidecar and one-off task logs in CloudWatch with 30-day retention, so that I can investigate recent problems without paying to keep logs forever.
46. As the maintainer, I want an ECR repository with immutable tags, so that a published image tag always means the same bytes.
47. As the maintainer, I want ECR to keep only the last 10 published images and expire untagged ones quickly, so that registry storage doesn't grow unbounded.
48. As the maintainer, I want ECR lifecycle rules not to orphan or delete signatures and SBOM referrers of images that are kept, so that kept images stay verifiable.
49. As the maintainer, I want budget alerts at $10 actual and $20 forecast, so that I'm told early every month that something is running and costing money.
50. As the maintainer, I want the tunnel token kept only in encrypted state and marked sensitive, so that it never appears in plan output.
51. As the maintainer, I want no IAM role for continuous deployment until CD exists, so that there's no unused privileged identity to attack.

## Implementation Decisions

**Region and cost:**
- **Region:** eu-north-1. Live AWS Price List data showed it to be the cheapest EU region for this combination (Fargate, RDS, NAT, Logs). eu-west-1 has slightly cheaper Fargate but more expensive RDS and load balancing, so totals are within about $1/month.
- **Expected cost:** about $62/month, almost entirely fixed. The largest item is the NAT Gateway plus its Elastic IP (about $37). Usage-driven costs (NAT processing, CloudWatch ingestion, transfer) come to under $1/month at the expected one-to-two-user traffic, and internet egress falls under AWS's free monthly allowance.
- A cheaper variant (task in a public subnet with a public IP and zero inbound rules, about $28/month) was considered and rejected in favour of the private-subnet posture.

**Terraform layout and tooling:**
- Two root configurations: **bootstrap** (local state, applied once from the maintainer's laptop) and **prod** (S3 backend).
- Resources are hand-written and grouped one file per concern (network, database, compute, registry, tunnel/DNS, IAM, observability).
- An exact Terraform 1.x version is pinned in both `required_version` and a version file read by CI's setup action. The AWS and Cloudflare providers are pinned to `~>` minor versions. The `.terraform.lock.hcl` file is committed with checksums for darwin-arm64 and linux-arm64. The tflint AWS ruleset plugin is pinned.
- Terraform, not OpenTofu.

**Bootstrap config:**
- **State bucket:** KMS encryption, versioning, public access blocked, and a bucket policy limiting access to the maintainer's admin role and the plan role. Locking uses the S3 native lockfile (`use_lockfile`), with no DynamoDB table.
- **GitHub OIDC provider.**
- **ECR push role:** trust is limited to the `main` branch of `sgspinola/pensieve`. It can only push to the pensieve repository.
- **Plan role:** trust is limited to the `plan` GitHub Environment of the repository. It has AWS read-only access plus read access to the state bucket and its lockfile.
- No deploy/CD role until CD exists.

**Network:**
- **VPC:** subnets in two AZs, because AWS requires an RDS subnet group to span at least two. The ECS task and the RDS instance each run in a single AZ.
- **Private subnet** for the task, with a single NAT Gateway and Elastic IP for egress (ECR, CloudWatch Logs, Secrets Manager, Cloudflare).
- **S3 gateway endpoint**, so ECR layer pulls bypass the NAT.
- **Security groups:** the RDS security group accepts Postgres only from the task's security group. The task's security group allows no inbound traffic.

**Ingress (Cloudflare):**
- A Cloudflare Tunnel connects outbound from a `cloudflared` sidecar container in the app's task to the app container over the task's local network. No ALB, no inbound ports, no Origin CA certificate, no Authenticated Origin Pulls.
- Managed through the Cloudflare Terraform provider: the tunnel, its ingress configuration, and the `pensieve.fyi` apex DNS record pointing at the tunnel. SSL mode is Full (strict) wherever it applies.
- The tunnel token lives in Terraform state, which is KMS-encrypted and readable only by the admin and plan roles, and reaches the sidecar as an ECS secret via Secrets Manager. Every resource attribute or output carrying the token must be marked sensitive, and any the provider doesn't mark get wrapped explicitly.
- **WebAuthn:** RP ID `pensieve.fyi`, origin `https://pensieve.fyi`, set as task environment variables.

**Database:**
- RDS PostgreSQL 17, `db.t4g.micro`, single-AZ, 20 GB gp3 with storage autoscaling up to 50 GB, in private subnets.
- **Backups:** 35-day automated backups with point-in-time recovery, backup window around 03:00 UTC, deletion protection on, final snapshot on delete, automated backups retained on delete.
- **Encryption:** storage encrypted with the AWS-managed RDS key.
- **Master password:** managed by RDS (`manage_master_user_password`), so it never enters state.
- **IAM database authentication** is enabled on the instance.
- **Database roles:**
  - **Migrator role:** owns the schema and performs DDL.
  - **App role:** `SELECT`/`INSERT`/`UPDATE`/`DELETE` on tables and `USAGE` on sequences, granted through `ALTER DEFAULT PRIVILEGES FOR ROLE <migrator>`, so tables the migrator creates later are covered automatically. No DDL, and no access to Drizzle's migration-bookkeeping schema.
  - Both roles are granted `rds_iam`, which disables password login for them.
- **Database bootstrap task:** a one-off ECS task definition running the same image with a bootstrap entrypoint. It connects as master using the RDS-managed master secret, and its task definition is the only one allowed to read that secret. It idempotently creates both roles, grants `rds_iam`, and sets up ownership and default privileges. It runs once after the first apply, and again only if the role model changes.
- **IAM policies:** the migrate task's role may `rds-db:connect` only as the migrator user, and the app task's role only as the app user. Neither task holds any database secret.

**Application changes:**
- **Database connection helper:**
  - When `DATABASE_URL` is set, it behaves as today (local development, CI).
  - Otherwise it builds the connection from host, port, database name and user environment variables. The password is an async function that signs a fresh 15-minute IAM token per new connection using the AWS SDK's RDS signer, with the task role's credentials.
  - TLS uses the bundled RDS CA certificate bundle shipped in the image.
- The Drizzle migrator entrypoint (spec 10) uses the same helper, so it gains IAM mode for free.
- **Startup schema check:** at boot, the app compares the migrations bundled in the image with those recorded in the database. If any are pending, it exits with an error, so the container never becomes healthy and ECS's circuit breaker rolls back.

**Compute:**
- ECS cluster on Fargate, `ARM64`. One service with a desired count of 1. Task size 0.25 vCPU / 1 GB, shared by the app and the `cloudflared` sidecar.
- **Deployment configuration:** minimum healthy 0%, maximum 100%, so the old task stops before the new one starts and two versions never coexist. Deployment circuit breaker with rollback enabled.
- **Container health check:** the image's Node health script against the health endpoint.
- **Task definition ownership:** Terraform creates the initial task definitions (app, migrate, db-bootstrap). The service ignores later changes to its task definition, so deploys (spec 12) register new revisions without causing Terraform drift.
- Task execution role and per-task task roles, with least privilege as described.

**Registry:** an ECR repository with immutable tags. Lifecycle policy: keep the last 10 `sha-*` images and expire untagged images after 1 day. The rules must keep the cosign signature and SBOM referrer artifacts attached to kept images; verify this when spec 12 first publishes.

**Observability and cost:**
- CloudWatch log groups for the app, `cloudflared`, migrate and db-bootstrap, each with 30-day retention, written through the `awslogs` driver from the app's existing JSON-lines stdout.
- **AWS Budgets:** a monthly budget with notifications at $10 actual and $20 forecast to the maintainer's email. These are expected to fire every month as a "something is running" signal. No CloudWatch alarms.

**CI `iac` job** (added to the spec 10 workflow, running only when infrastructure code is present):
- `terraform fmt -check`, `validate` (initialised without a backend), and tflint with the AWS plugin.
- On `pull_request` from same-repository branches only, `terraform plan` runs in the `plan` GitHub Environment. It authenticates to AWS via OIDC as the plan role, and to Cloudflare with a read-only (Zone and Tunnel read) API token stored as an environment secret.
- The plan's text output goes to the run summary. No plan file is written as an artifact, and `TF_LOG` is never set.

**Manual prerequisites:**
- an IAM Identity Center admin user
- a Cloudflare API token for local applies
- a read-only Cloudflare token for the `plan` environment
- creating the `plan` GitHub Environment

## Testing Decisions

- **Good tests verify behaviour visible from outside the module:** what a role can and can't do, what the helper connects with, whether startup is refused. They don't check how those things are implemented.
- **DB grants (Vitest database seam):** using the existing `createTestDb` harness, run the bootstrap's role and grant logic against the test database with a stub `rds_iam` role, since vanilla Postgres has none. Then apply migrations as the migrator and connect as the app role. Assert that the app role can select, insert, update and delete in a migrated table; that it's refused DDL (e.g. creating or dropping a table); and that a table created by the migrator *after* bootstrap is still writable by the app role, which proves default privileges work. This catches a missing grant before production, independent of e2e, which runs as superuser.
- **Startup schema check (Vitest database seam):** against the test database, the check reports up to date when every bundled migration is recorded, and reports pending when one is missing.
- **Connection helper (pure unit tests):** given `DATABASE_URL`, it yields URL-based config. Otherwise it yields host/user config whose password function calls the injected token signer, a test double, on each invocation, and enables TLS with the CA bundle.
- **Terraform** isn't unit-tested: `fmt`, `validate`, tflint and the CI plan cover it, and the first real apply proves it.
- **Prior art:** the existing service-layer tests built on `createTestDb` (e.g. the ping service test), and the existing pure-function tests in the lib directory.

## Out of Scope

- Continuous deployment, and the CI deploy role it would need.
- Publishing images to ECR, signing, SBOM referrers, and the deploy/migrate scripts and runbooks (spec 12).
- Staging or any non-production environment.
- Multi-AZ RDS or more than one task.
- Cross-region or cross-account backup copies (AWS Backup, Vault Lock).
- CloudWatch alarms, metric filters, SNS-based alerting and error-tracking services; Budgets alerts only.
- A "panic button" to stop all compute when a budget is exceeded.
- A Cloudflare maintenance page during deploy downtime.
- An Application Load Balancer, Origin CA certificates and Authenticated Origin Pulls; all replaced by the Tunnel.
- VPC interface endpoints and NAT instances (fck-nat).
- Aurora Serverless.
- Wiring the `@logtape/cloudwatch-logs` sink. stdout plus the `awslogs` driver is sufficient, as spec 08 anticipated.

## Further Notes

**How this relates to spec 08:**
- It resolves spec 08's open question about the deployment target (ECS Fargate in eu-north-1). Production logging stays on stdout, ingested by the `awslogs` driver, exactly as spec 08 assumed.
- Its expected/unexpected log-level split remains the basis for any future metric filter.

**Cost options compared** (monthly, eu-north-1):
- Ingress: an ALB with mTLS/AOP (about $25) or a Tunnel ($0).
- Egress:
  - public IP ($3.65)
  - fck-nat (about $7)
  - VPC interface endpoints (about $31)
  - NAT Gateway (about $37)
- Tunnel + NAT was chosen.

**Why not ARM before:** emulated arm64 builds on private-repo runners would have been slow and eaten the free Actions minutes. Making the repository public made native arm64 runners free, which tipped the choice to Graviton.

This spec came out of the same `grill-me` session as specs 10 and 12. Prices came from the live AWS Price List API, not from memory.
