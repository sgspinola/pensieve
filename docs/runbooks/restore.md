# Restore the database

A restore never rewinds the running instance. RDS always restores into a **new instance**, so recovery means stopping the app, restoring next to the old instance, swapping the two instances' names, telling Terraform about the swap, and starting the app again. Plan on about an hour of downtime.

Restores run locally as the admin user (`aws login --profile pensieve-admin`). No GitHub role can restore, rename or delete an instance. The Terraform step also needs your Cloudflare API token, the same as any prod apply.

::: warning Not yet rehearsed
This procedure hasn't been run end to end yet. Steps 3 and 4 (the rename swap and the Terraform import) are the least certain: if the plan in step 4 shows anything replacing `aws_db_instance.main`, stop.
:::

## Which restore

| Situation | Restore from | You lose |
| --- | --- | --- |
| Rolling back a `deploy-db` run, e.g. after a breaking migration | The pre-deploy snapshot that run took | Every write since the snapshot (the app was stopped while it was taken, so normally nothing) |
| Data damaged or deleted at a known time | Point-in-time recovery to just before it | Every write after that time |
| Anything older than the last `deploy-db` | Point-in-time recovery | Every write after that time |

**Only the newest pre-deploy snapshot exists.** Each `deploy-db` run takes `pensieve-predeploy-<db_sha>-<UTC time>` and then deletes the older ones. Anything older comes from point-in-time recovery, which covers the last 35 days to within about five minutes of now.

List what's available:

```sh
aws rds describe-db-snapshots --db-instance-identifier pensieve --snapshot-type manual \
  --query 'DBSnapshots[].[DBSnapshotIdentifier,SnapshotCreateTime,Status]' --output table
aws rds describe-db-instance-automated-backups --db-instance-identifier pensieve \
  --query 'DBInstanceAutomatedBackups[].RestoreWindow' --output table
```

## What changes, and what doesn't

The restored instance takes over the name `pensieve`, so everything that finds the database by name keeps working:
- its endpoint (`PGHOST` in every task definition), so no task definition needs a new revision for the app or the migrator
- the CI roles' permissions (`infra/bootstrap/names.tf` scopes them to `db:pensieve`)
- the RDS log groups (`/aws/rds/instance/pensieve/*`)

Two things are new and must go through Terraform before the app can connect:
- **The resource ID** (`db-…`). The app and migrate task roles may `rds-db:connect` only to the old instance's ID (`infra/prod/iam.tf`), so until the apply the app's IAM login fails.
- **The master password secret.** The restore creates a new RDS-managed secret. The `pensieve-db-bootstrap` task definition and its execution role name the secret's ARN, so the apply registers a new db-bootstrap revision.

## 1. Stop the app

Record the service's revision and count, then scale it to 0. A restore point in the future of a running app loses whatever it writes meanwhile, and an app on the wrong data does more damage.

```sh
aws login --profile pensieve-admin
export AWS_PROFILE=pensieve-admin
aws ecs describe-services --cluster pensieve --services pensieve \
  --query 'services[0].[taskDefinition,desiredCount]' --output text
# note both down
aws ecs update-service --cluster pensieve --service pensieve --desired-count 0 --output json >/dev/null
aws ecs wait services-stable --cluster pensieve --services pensieve
```

After a breaking migration the app is usually down already (the startup check refuses the schema); scale it to 0 anyway, so the service stops retrying.

## 2. Restore into a new instance

The restored instance is created as `pensieve-restored`, in the same subnet group, AZ, security group and parameter group as prod, with IAM authentication, a managed master password and deletion protection on. Log exports stay off until it's renamed, so RDS doesn't create log groups under the temporary name.

```sh
rds_sg=$(aws ec2 describe-security-groups --filters Name=group-name,Values=pensieve-rds \
  --query 'SecurityGroups[0].GroupId' --output text)
common=(
  --db-instance-class db.t4g.micro
  --availability-zone eu-north-1a --no-multi-az
  --db-subnet-group-name pensieve --vpc-security-group-ids "$rds_sg" --no-publicly-accessible
  --db-parameter-group-name pensieve-postgres17
  --storage-type gp3
  --enable-iam-database-authentication --manage-master-user-password
  --backup-retention-period 35 --preferred-backup-window 02:30-03:30
  --copy-tags-to-snapshot --deletion-protection
  --tags Key=Project,Value=pensieve Key=ManagedBy,Value=terraform Key=Config,Value=prod
)
```

**Point-in-time** (the time is UTC; `--use-latest-restorable-time` instead for "as late as possible"):

```sh
aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier pensieve \
  --target-db-instance-identifier pensieve-restored \
  --restore-time 2026-10-13T09:00:00Z "${common[@]}" --output json >/dev/null
```

**Pre-deploy snapshot:**

```sh
aws rds restore-db-instance-from-db-snapshot --db-snapshot-identifier pensieve-predeploy-<db_sha>-<time> \
  --db-instance-identifier pensieve-restored "${common[@]}" --output json >/dev/null
```

Then wait. It takes 10 to 20 minutes, and the wait command gives up after 30, so re-run it if it times out:

```sh
aws rds wait db-instance-available --db-instance-identifier pensieve-restored
```

## 3. Swap the names

Rename the old instance out of the way, then the restored one into its place. Each rename reboots that instance and takes a few minutes. The old instance stays, with its data and its own backups, until step 6.

```sh
aws rds modify-db-instance --db-instance-identifier pensieve --new-db-instance-identifier pensieve-old \
  --apply-immediately --output json >/dev/null
aws rds wait db-instance-available --db-instance-identifier pensieve-old
aws rds modify-db-instance --db-instance-identifier pensieve-restored --new-db-instance-identifier pensieve \
  --apply-immediately --output json >/dev/null
aws rds wait db-instance-available --db-instance-identifier pensieve
```

`describe-db-instances --db-instance-identifier pensieve` should now show the old endpoint address and a new `DbiResourceId`.

## 4. Point Terraform at the restored instance

Terraform's state still tracks the old instance by its resource ID, so swap it, then apply. Set up the shell as in `infra/prod/README.md`, "Applying it" (the Cloudflare token and the two logging switches), then:

```sh
cd infra/prod
terraform state rm aws_db_instance.main
terraform import aws_db_instance.main pensieve
terraform plan -out prod.tfplan   # review it
terraform apply prod.tfplan
```

The plan must change `aws_db_instance.main` **in place**, never replace it. Expect:
- `aws_db_instance.main`: the log exports, `max_allocated_storage`, the maintenance window, and Terraform-only arguments like `final_snapshot_identifier`
- the app and migrate task roles' `rds-db:connect` policies: the new resource ID
- the db-bootstrap execution role's policy and `aws_ecs_task_definition.db_bootstrap` (replaced): the new master secret

Anything else, stop and work out why before applying.

## 5. Start the app and check it

**After data damage:** start the recorded revision at the recorded count:

```sh
aws ecs update-service --cluster pensieve --service pensieve \
  --task-definition <recorded revision> --desired-count <recorded count> --output json >/dev/null
aws ecs wait services-stable --cluster pensieve --services pensieve
```

**After a breaking migration:** dispatch `deploy-app` with the previous `app_sha`. It starts the service at 1. Redeploying the old image without the restore isn't enough: its startup check refuses the newer schema.

Then check:
- `curl -s https://pensieve.fyi/api/health` answers `{"status":"up"}`.
- You can sign in, and the data is as of the restore point: the last thing you expect to see is there, and what you meant to undo isn't.
- `/ecs/pensieve-app` shows no `PAM authentication failed` or startup schema refusals.

## 6. Clean up the old instance

Once you're sure the restored data is right, delete the old instance. Its automated backups are kept until they age out of the 35 days, so a point in time from before the restore stays reachable (`restore-db-instance-to-point-in-time --source-db-instance-automated-backups-arn`), with this same procedure.

```sh
aws rds modify-db-instance --db-instance-identifier pensieve-old --no-deletion-protection \
  --apply-immediately --output json >/dev/null
aws rds delete-db-instance --db-instance-identifier pensieve-old \
  --skip-final-snapshot --no-delete-automated-backups --output json >/dev/null
```

Until it's deleted the old instance costs as much as prod's. Its master secret goes with it.

The pre-deploy snapshots stay listed under the identifier `pensieve`, so the next `deploy-db` run still prunes them.
