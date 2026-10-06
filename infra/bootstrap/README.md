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
   so a wrong name locks everyone but the account root out of the state.
2. **Terraform:** exactly the version in `infra/.terraform-version`
   (`brew install tfenv && tfenv install`, or the `hashicorp/terraform:<version>`
   Docker image).
3. **Apply:**

   ```sh
   aws login --profile pensieve-admin
   export AWS_PROFILE=pensieve-admin
   cd infra/bootstrap
   terraform init
   terraform plan -out bootstrap.tfplan   # review: 1 bucket, 1 KMS key, 1 OIDC provider, 4 roles, 1 access analyzer
   terraform apply bootstrap.tfplan
   terraform output
   ```

4. **Hand the outputs on** (none is a secret): the bucket name goes into the
   prod config's backend block, and each role ARN into the GitHub variable its
   workflow reads (tickets 47, 50–52, 54).

## CI plan

CI's `iac` job (ticket 47) plans the prod config on PRs from this repository's
own branches, inside the `plan` GitHub Environment. Set it up once, by hand:

1. Create the `plan` Environment (Settings → Environments). No reviewers or
   branch rule: forks and Dependabot never enter it, and the role it unlocks
   is read-only.
2. Add the Environment variable `PLAN_ROLE_ARN`: `terraform output role_arns`'
   `plan` value.
3. Add the Environment secret `CLOUDFLARE_API_TOKEN`: a Cloudflare API token
   with only Zone Read and Cloudflare Tunnel Read, scoped to `pensieve.fyi`
   and the account.

The plan's text goes only to the job's run summary. No plan file is kept and
`TF_LOG` is never set, so state values can't leak into this public
repository's logs or artifacts beyond what the plan itself prints (Terraform
masks sensitive values there).

## Changing it

Edit, `terraform plan`, review, `terraform apply`, all from the laptop as
above. CI never applies this config: it can't create or widen its own
identity. When bumping the AWS provider, refresh the lockfile for both
platforms:

```sh
terraform providers lock -platform=darwin_arm64 -platform=linux_arm64
```
