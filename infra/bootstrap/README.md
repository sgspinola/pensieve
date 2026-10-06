# Bootstrap config

Ticket 46 (spec 11, "Bootstrap config"). Creates what every other piece of
infrastructure depends on, once, from the maintainer's laptop:

- the KMS-encrypted, versioned S3 bucket the prod config keeps its state in
  (S3 native lockfile locking, no DynamoDB table)
- the GitHub Actions OIDC identity provider
- four CI roles, each assumable only from one GitHub context:

  | Role | Trusted from | Can |
  | --- | --- | --- |
  | `pensieve-github-ecr-push` | pushes to `main` | push to the `pensieve` and `pensieve-db` ECR repositories |
  | `pensieve-github-plan` | the `plan` Environment | read-only AWS, read the state and its lockfile (and the tunnel-token secret, which the state already holds) |
  | `pensieve-github-deploy-app` | the `prod-app` Environment on `main` | roll the service to a new app task-definition revision |
  | `pensieve-github-deploy-db` | the `prod-db` Environment on `main` | snapshot, run the migrate task, roll the service |

- an account-wide IAM Access Analyzer, which flags any of the above (or
  anything later) that becomes reachable from outside the account
- the account audit trail (ticket 58), for investigating after an incident,
  not alerting:
  - the log bucket `pensieve-logs-<account>`: SSE-S3, versioned, TLS-only,
    readable only by the admin user. AWS services may only write, each to its
    own prefix, which also sets how long objects are kept: `cloudtrail/` 90
    days, `vpc-flow/` and `resolver/` 30 days (prod delivers these, ticket
    59), `athena-results/` 7 days. Deleted or overwritten logs stay
    recoverable as noncurrent versions for 30 days
  - a multi-region CloudTrail trail with log file validation: read and write
    management events, every object-level call on the state bucket, and
    every call on the log bucket's objects except `PutObject` (so delivery
    doesn't feed back into the trail)
  - the Athena workgroup `pensieve` and Glue database `pensieve_logs` with a
    `cloudtrail` table. Partition projection over `region` and `day`, so
    there are no partitions to add

The deploy roles are scoped by ARN to resources the prod config creates later
(cluster, service, task families, task roles, log group, RDS instance). Their
names live in `names.tf`, and prod must use exactly those, including one
execution role per task family. Both deploy roles may only `UpdateService`
with an app-family task definition, so every deploy passes one, even the
first (the service starts at desired count 0).

State is local (`terraform.tfstate` here, git-ignored) on purpose: this config
creates the bucket remote state would need. Nothing in it is secret, and every
resource can be re-imported if the file is lost. Keep a copy somewhere safe
anyway.

## Applying it

The procedure for the bootstrap runbook (ticket 56).

1. **Prerequisites:** an IAM user named `pensieve-admin` with
   `AdministratorAccess`, signed in with `aws login --profile pensieve-admin`
   (short-lived console credentials, no access keys). Never root access keys.
   If the user has another name, pass `-var admin_user_name=<name>`: the state
   bucket policy denies every principal except that user and the plan role,
   and the log bucket policy every principal except that user, so a wrong
   name locks everyone but the account root out of the state and the logs.
2. **Terraform:** exactly the version in `infra/.terraform-version`
   (`brew install tfenv && tfenv install`, or the `hashicorp/terraform:<version>`
   Docker image).
3. **Apply:**

   ```sh
   aws login --profile pensieve-admin
   export AWS_PROFILE=pensieve-admin
   cd infra/bootstrap
   terraform init
   terraform plan -out bootstrap.tfplan   # review: see below
   terraform apply bootstrap.tfplan
   terraform output
   ```

   The plan should show 2 buckets (state and logs), 1 KMS key, 1 OIDC
   provider, 4 roles, 1 access analyzer, 1 trail, 1 Athena workgroup and 1
   Glue database and table: `Plan: 30 to add` from scratch. On a bootstrap
   applied before ticket 58, it's `Plan: 11 to add, 0 to change, 0 to
   destroy`: the log bucket and its 6 settings resources, the trail, the
   workgroup, the database and the table.

4. **Hand the outputs on** (none is a secret): the bucket name goes into the
   prod config's backend block, and each role ARN into the GitHub variable its
   workflow reads (tickets 47, 50–52, 54).
5. **Check the audit trail** once a CI plan has run (ticket 47). In the
   Athena console, pick the `pensieve` workgroup and:

   ```sql
   SELECT eventtime, useridentity.arn, requestparameters
   FROM pensieve_logs.cloudtrail
   WHERE day >= date_format(current_date - interval '1' day, '%Y/%m/%d')
     AND eventsource = 's3.amazonaws.com' AND eventname = 'GetObject'
     AND useridentity.sessioncontext.sessionissuer.username = 'pensieve-github-plan'
   ORDER BY eventtime DESC;
   ```

   It should list the plan role reading the prod state file. Then check the
   log files haven't been altered since delivery:

   ```sh
   aws cloudtrail validate-logs \
     --trail-arn "$(aws cloudtrail describe-trails --trail-name-list pensieve \
       --query 'trailList[0].TrailARN' --output text)" \
     --start-time "$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ)"
   ```

   CloudTrail delivers within about 15 minutes, and the first digest file
   an hour after the trail is created.

## Changing it

Edit, `terraform plan`, review, `terraform apply`, all from the laptop as
above. CI never applies this config: it can't create or widen its own
identity. When bumping the AWS provider, refresh the lockfile for both
platforms:

```sh
terraform providers lock -platform=darwin_arm64 -platform=linux_arm64
```
