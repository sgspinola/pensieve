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
- A tiny **bootstrap** config, applied once from the maintainer's laptop, creates what everything else depends on: an encrypted, versioned S3 state bucket with native lockfile locking, the GitHub OIDC identity provider, and four narrowly scoped CI roles: ECR push, read-only plan, and the `deploy-app` and `deploy-db` roles used by the manually dispatched deploy workflows (specs 12 and 13).
- The main **prod** config, in eu-north-1 (Stockholm, the cheapest EU region for this stack), stores its state in that bucket and provisions:
  - a VPC with the app task in a private subnet behind a NAT Gateway
  - a single-AZ RDS PostgreSQL 17 instance with 35-day point-in-time recovery and deletion protection
  - an ECS Fargate (arm64) service running the app plus a `cloudflared` sidecar
  - two ECR repositories: `pensieve` for the app image and `pensieve-db` for the DB image (spec 13)
  - CloudWatch log groups
  - AWS Budgets alerts
  - and, through the Cloudflare provider, the Tunnel and DNS for `pensieve.fyi`

There's **no load balancer and no inbound port at all**. The `cloudflared` sidecar dials out to Cloudflare, so the origin is unreachable from the internet by construction, which is a stronger guarantee than mTLS between Cloudflare and an ALB, and about $25/month cheaper.

The app authenticates to Postgres with **RDS IAM authentication**: short-lived tokens signed with the task's IAM role, so no database password exists in the app task. A dedicated migrator role owns the schema; the app role can only read and write rows. This spec provides the AWS side of the database lifecycle: the instance, IAM auth, the task definitions, the task roles and the deploy roles. Spec 13 owns the rest: the role and grant model, the DB image, the bootstrap, migrations and the app's startup schema check.

CI gains Terraform formatting, validation, linting and a read-only `plan` on pull requests, carefully arranged so that no secret (in particular the tunnel token held in state) can leak into public logs or artifacts.

## User Stories

1. As the maintainer, I want all AWS and Cloudflare infrastructure defined in Terraform, so that the environment is reproducible and every change is reviewable as code.
2. As the maintainer, I want Terraform state stored remotely in S3 with versioning, encryption and locking, so that state isn't lost with my laptop, can be recovered after corruption, and two applies can't collide.
3. As the maintainer, I want the state bucket and CI identity created by a separate, one-off bootstrap config, so that the chicken-and-egg problem (state bucket, CI auth) is solved once and explicitly.
4. As the maintainer, I want to apply the bootstrap locally with my own credentials, so that CI never holds the power to create its own identity.
5. As the maintainer, I want to sign in as a dedicated admin IAM user with `aws login` (short-lived console credentials, no access keys) rather than root access keys, so that my local AWS access is short-lived and auditable.
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
34. As the maintainer, I want a separate migrator user that owns the schema, so that DDL rights exist only in the migration task (which runs the DB image, spec 13).
35. As the maintainer, I want each task's IAM role able to log in only as its own database user, so that the app task can't impersonate the migrator.
36. As the maintainer, I want new tables automatically granted to the app user, so that a new migration can't silently break the app with a missing grant.
37. As the maintainer, I want the master credential readable only by a one-off database bootstrap task that only I can launch, so that routine tasks and CI never hold it, not even indirectly.
38. As the maintainer, I want the database bootstrap to be idempotent, so that I can re-run it safely if roles or grants change (spec 13).
39. As a developer, I want local development and CI to keep using a plain `DATABASE_URL`, so that IAM authentication doesn't complicate anything outside AWS.
40. As an operator, I want database connections to RDS encrypted and verified against the RDS certificate authority, so that IAM auth's TLS requirement is met properly.
41. As an operator, I want the app to refuse to start when the schema is incompatible with it, so that a deploy in the wrong order fails fast instead of running against the wrong schema. Spec 13 defines the two-sided check.
42. As an operator, I want ECS to roll back automatically when a new task fails to become healthy, so that a bad deploy doesn't leave the app down.
43. As an operator, I want the old and new app versions never to run at the same time, so that a migration only ever has to be compatible with one version.
44. As an operator, I want container health judged by the app's health endpoint, so that ECS replaces a task whose database connection is broken.
45. As an operator, I want app, sidecar and one-off task logs in CloudWatch with 30-day retention, so that I can investigate recent problems without paying to keep logs forever.
46. As the maintainer, I want separate ECR repositories for the app and DB images, both with immutable tags, so that the two artifacts are released independently and a published tag always means the same bytes.
47. As the maintainer, I want ECR to keep only the last 10 published images and expire untagged ones quickly, so that registry storage doesn't grow unbounded.
48. As the maintainer, I want ECR lifecycle rules not to orphan or delete signatures and SBOM referrers of images that are kept, so that kept images stay verifiable.
49. As the maintainer, I want budget alerts at $10 actual and $20 forecast, so that I'm told early every month that something is running and costing money.
50. As the maintainer, I want the tunnel token kept only in encrypted state and marked sensitive, so that it never appears in plan output.
51. As the maintainer, I want separate deploy roles for the app and the database, each assumable only from its own approval-gated GitHub Environment on `main`, so that deploying needs my explicit approval and a compromised app deploy can't touch the database.
52. As the maintainer, I want the app service to start at zero tasks and Terraform to ignore its desired count and task definition, so that the first deploy and every later one belong to the deploy workflows without causing drift.

## Implementation Decisions

**Region and cost:**
- **Region:** eu-north-1. Live AWS Price List data showed it to be the cheapest EU region for this combination (Fargate, RDS, NAT, Logs). eu-west-1 has slightly cheaper Fargate but more expensive RDS and load balancing, so totals are within about $1/month.
- **Expected cost:** about $62/month, almost entirely fixed. The largest item is the NAT Gateway plus its Elastic IP (about $37). Usage-driven costs (NAT processing, CloudWatch ingestion, transfer) come to under $1/month at the expected one-to-two-user traffic, and internet egress falls under AWS's free monthly allowance.
- A cheaper variant (task in a public subnet with a public IP and zero inbound rules, about $28/month) was considered and rejected in favour of the private-subnet posture.

**Terraform layout and tooling:**
- Two root configurations: **bootstrap** (local state, applied once from the maintainer's laptop) and **prod** (S3 backend).
- Resources are hand-written and grouped one file per concern (network, database, compute, registry, tunnel/DNS, IAM, observability).
- An exact Terraform 1.x version is pinned in both `required_version` and a version file read by CI's setup action. (Revised during ticket 47: the repository allows only GitHub-owned actions, so CI runs Terraform and tflint as digest-pinned images, and a step fails if the Terraform image's tag differs from `infra/.terraform-version`.) The AWS and Cloudflare providers are pinned to `~>` minor versions. The `.terraform.lock.hcl` file is committed with checksums for darwin-arm64 and linux-arm64. The tflint AWS ruleset plugin is pinned.
- Terraform, not OpenTofu.

**Bootstrap config:**
- **State bucket:** KMS encryption, versioning, public access blocked, and a bucket policy limiting access to the maintainer's admin IAM user and the plan role. Locking uses the S3 native lockfile (`use_lockfile`), with no DynamoDB table.
- **GitHub OIDC provider.**
- **ECR push role:** trust is limited to the `main` branch of `sgspinola/pensieve`. It can only push to the `pensieve` and `pensieve-db` repositories.
- **Plan role:** trust is limited to the `plan` GitHub Environment of the repository. It has AWS read-only access plus read access to the state bucket and its lockfile.
- **`deploy-app` role:** trust is limited to the `prod-app` GitHub Environment on `main`. It can:
  - describe and pull from the `pensieve` repository
  - register task definitions in the app family
  - update and describe the one ECS service
  - `iam:PassRole` for the app task and execution roles only
- **`deploy-db` role:** trust is limited to the `prod-db` GitHub Environment on `main`. It can:
  - describe and read both repositories, so that `cosign verify` can fetch signatures
  - update and describe the service
  - register app and migrate task-definition revisions, and `ecs:RunTask`/`DescribeTasks` on the migrate family only
  - `iam:PassRole` for the app and migrate task and execution roles only
  - `rds:CreateDBSnapshot`, `DescribeDBSnapshots` and `AddTagsToResource` on the instance
  - `rds:DeleteDBSnapshot` only on snapshots named `pensieve-predeploy-*`
  - read CloudWatch Logs for the migrate log group

  It has no access to the bootstrap task family, its roles, or the master secret. It has no RDS modify, restore or delete-instance permissions.

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
- **Database roles** (migrator and app, both granted `rds_iam`, which disables password login) are defined in spec 13, together with their grants and the bootstrap that creates them.
- **Database bootstrap task:** a one-off ECS task definition on the **DB image** (spec 13) with its bootstrap entrypoint. It connects as master using the RDS-managed master secret. Its task role is the only principal allowed to read that secret, and only the maintainer's local `db-bootstrap` script launches it. No GitHub role can run it or pass its roles.
- **Migrate task:** a one-off ECS task definition on the DB image, run by the `deploy-db` workflow (spec 13).
- **IAM policies:** the migrate task's role may `rds-db:connect` only as the migrator user, and the app task's role only as the app user. Neither task holds any database secret.

**Application changes:**
- **Database connection helper:**
  - When `DATABASE_URL` is set, it behaves as today (local development, CI).
  - Otherwise it builds the connection from host, port, database name and user environment variables. The password is an async function that signs a fresh 15-minute IAM token per new connection using the AWS SDK's RDS signer, with the task role's credentials.
  - TLS uses the bundled RDS CA certificate bundle shipped in the image.
- The DB image's migrate and bootstrap entrypoints (spec 13) use the same helper, so they gain IAM mode for free. The bootstrap connects as the master user with the master secret instead of a token.
- **Startup schema check:** the two-sided compatibility check defined in spec 13. If the schema is incompatible, the app exits with an error, so the container never becomes healthy and ECS's circuit breaker rolls back.

**Compute:**
- ECS cluster on Fargate, `ARM64`. One service with a desired count of 1. Task size 0.25 vCPU / 1 GB, shared by the app and the `cloudflared` sidecar.
- **Deployment configuration:** minimum healthy 0%, maximum 100%, so the old task stops before the new one starts and two versions never coexist. Deployment circuit breaker with rollback enabled.
- **Container health check:** the image's Node health script against the health endpoint.
- **Task definition ownership:** Terraform creates the initial task definitions: app on the app image, and migrate and db-bootstrap on the DB image. The service is created with a desired count of 0 and ignores later changes to its task definition and desired count. The deploy workflows (specs 12 and 13) and the local bootstrap script register new revisions without causing Terraform drift.
- Task execution role and per-task task roles, with least privilege as described.

**Registry:** two ECR repositories, `pensieve` (app) and `pensieve-db` (DB image, spec 13), with identical settings. Each has immutable tags. Lifecycle policy: keep the last 50 `sha-*` images (a `tagPatternList` rule) and expire untagged images after 1 day. No archive tier: archived images can't be pulled, and restoring one takes up to 20 minutes. (Revised during ticket 38's reversal: the count was 10. Every push to `main` now publishes, and deploys are manual, so the running image can be several releases old. ECR doesn't protect an image a running task uses: once its digest expires, any replacement task fails to pull. 50 makes that need 50 releases without a deploy, for well under $1/month of storage.) Cosign signatures and SBOMs are stored as OCI 1.1 referrers (spec 12). ECR protects those while their image exists and removes them after it's deleted. Legacy `sha256-….sig` tags would be ordinary tagged images, never cleaned up. Verify both when spec 12 first publishes.

**Observability and cost:**
- CloudWatch log groups for the app, `cloudflared`, migrate and db-bootstrap, each with 30-day retention, written through the `awslogs` driver from the app's existing JSON-lines stdout.
- **AWS Budgets:** a monthly budget with notifications at $10 actual and $20 forecast to the maintainer's email. These are expected to fire every month as a "something is running" signal. No CloudWatch alarms.

**CI `iac` job** (added to the spec 10 workflow, running on every PR and push like every other job, and added to both rulesets' required checks by name; revised during ticket 38's reversal, which dropped path-conditional jobs and the `gate` job):
- `terraform fmt -check`, `validate` (initialised without a backend), and tflint with the AWS plugin.
- On `pull_request` from same-repository branches only, `terraform plan` runs in the `plan` GitHub Environment. It authenticates to AWS via OIDC as the plan role, and to Cloudflare with a read-only (Zone and Tunnel read) API token stored as an environment secret.
- The plan's text output goes to the run summary. No plan file is written as an artifact, and `TF_LOG` is never set.
- (Revised during ticket 47:) Dependabot's runs plan nothing and enter no Environment, since GitHub withholds Environment secrets from them; a maintainer's push to a Dependabot branch plans as usual. Plan only runs once `infra/prod` exists (ticket 48).

**Manual prerequisites:**
- an admin IAM user (`pensieve-admin`, `AdministratorAccess`) for `aws login`
- a Cloudflare API token for local applies
- a read-only Cloudflare token for the `plan` environment
- creating the `plan` GitHub Environment
- creating the `prod-app` and `prod-db` GitHub Environments, each with the maintainer as required reviewer and deployments limited to `main`

## Testing Decisions

- **Good tests verify behaviour visible from outside the module:** what a role can and can't do, what the helper connects with, whether startup is refused. They don't check how those things are implemented.
- **DB grants, migrator and startup schema check:** their Vitest database-seam tests are defined in spec 13.
- **Connection helper (pure unit tests):** given `DATABASE_URL`, it yields URL-based config. Otherwise it yields host/user config whose password function calls the injected token signer, a test double, on each invocation, and enables TLS with the CA bundle.
- **Terraform** isn't unit-tested: `fmt`, `validate`, tflint and the CI plan cover it, and the first real apply proves it.
- **Prior art:** the existing service-layer tests built on `createTestDb` (e.g. the ping service test), and the existing pure-function tests in the lib directory.

## Out of Scope

- Publishing images to ECR, signing, SBOM referrers, the `deploy-app` workflow and the runbooks (spec 12).
- The DB image, bootstrap SQL, migrations, the `deploy-db` workflow and the local bootstrap script (spec 13).
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
