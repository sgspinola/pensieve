# Bootstrap: from an empty account to a running app

This is the order that took production from an empty AWS account to `https://pensieve.fyi` serving the app (first done on 2026-10-12). Each step links to the README with its full commands. Nothing here runs in CI: the GitHub roles that CI uses are created in step 2.

## 1. Prerequisites

**AWS**
- An account with root MFA, and no root access keys.
- An IAM user named `pensieve-admin` with `AdministratorAccess` and an MFA device. You sign in with `aws login --profile pensieve-admin`, which gives short-lived console credentials and needs no access keys. If the user has another name, pass `-var admin_user_name=<name>` to the bootstrap config: its bucket policies name this user, and a wrong name locks everyone but root out of the state and the logs.
- Optionally, a `pensieve-auditor` user (`ReadOnlyAccess` and `SecurityAudit`, with MFA) for ScoutSuite runs.

**Tools:** Terraform at exactly the version in `infra/.terraform-version`, the AWS CLI, `gh`, cosign 3 or newer, and jq.

**Cloudflare**
- The `pensieve.fyi` zone in your Cloudflare account.
- An API token for local applies: Zone Read, DNS Edit and Zone Settings Edit on the zone, plus Cloudflare Tunnel Edit on the account. Keep it in a password manager.
- A read-only token for CI's plan: Zone, DNS and Zone Settings Read on the zone, plus Tunnel Read on the account.

**GitHub** (Settings, one-off; step 8 lists the rest)
- Three Environments:
  - `plan`: no reviewers and no branch rule
  - `prod-app` and `prod-db`: you as required reviewer, `main` only
- `plan` secrets: `CLOUDFLARE_API_TOKEN` (the read-only token) and `BUDGET_EMAIL`. Set them with `gh secret set <name> --env plan`, which prompts for the value, so it never lands in your shell history.
- `plan` variables: `NETWORK_LOGS_ENABLED` and `DB_LOG_EXPORTS_ENABLED`, `true` or `false`.

## 2. Apply the bootstrap config

Follow `infra/bootstrap/README.md`, "Applying it". From scratch, the plan is `Plan: 33 to add`. It creates:
- the KMS-encrypted state bucket
- the GitHub OIDC provider and the four CI roles
- IAM Access Analyzer
- the CloudTrail trail, the log bucket, and the Athena workgroup with its tables
- the account password policy

Then hand the outputs on:
- `role_arns.plan` → `PLAN_ROLE_ARN` variable in the `plan` Environment
- `role_arns.ecr_push` → `ECR_PUSH_ROLE_ARN` repository variable
- `role_arns.deploy_app` → `DEPLOY_APP_ROLE_ARN` variable in `prod-app`
- `role_arns.deploy_db` → `DEPLOY_DB_ROLE_ARN` variable in `prod-db`

Check the trail with the Athena query in that README once a CI plan has run.

## 3. Apply prod

Follow `infra/prod/README.md`, "Applying it". It needs `budget_email` in a git-ignored `infra/prod/terraform.tfvars`, the apply Cloudflare token in `CLOUDFLARE_API_TOKEN`, and both logging switches exported from the `plan` variables (`gh variable get`). This creates:
- the network, RDS, ECR, log groups and the budget
- the ECS cluster and service, at 0 tasks
- the task definitions and their roles
- the Cloudflare tunnel, DNS record and TLS setting
- the network and RDS logging

Then reboot the instance once, so pgaudit loads (README, "Database logging"):

```sh
aws rds reboot-db-instance --db-instance-identifier pensieve
```

## 4. Lock the site to your IP until the admin exists

The first passkey registered on an empty `users` table becomes the admin. Until you've registered yours, add a Cloudflare WAF custom rule on `pensieve.fyi` that blocks every request not from your IP. You remove it in step 7.

## 5. First release

Open a PR from `develop` to `main` and merge it with a merge commit. This is the only method `main` allows. On the push to `main`:
- `ci.yml`'s `publish` puts the app image in ECR `pensieve` as `sha-<7>`
- `db.yml`'s `publish-db` puts the DB image in `pensieve-db`

Both are signed. Check them with `cosign verify` against `ci.yml@refs/heads/main` and `db.yml@refs/heads/main` (issuer `https://token.actions.githubusercontent.com`).

The first release PR's `trufflehog` scan needed a fix: walking `main`'s whole history re-flagged old commits. Releases now scan the release's files instead.

## 6. Database roles, then the schema

1. **Roles and grants**, locally, as the admin user. Use the release's merge commit:
   ```sh
   AWS_PROFILE=pensieve-admin scripts/db-bootstrap.sh <sha>
   ```
   It runs `db/bootstrap.sql` as a one-off ECS task inside AWS, so the master password never leaves AWS. It also creates the pgaudit extension. It's idempotent: re-run it whenever the bootstrap SQL changes. (The first run made the master an indirect `rds_iam` member, which locked its password login, as ticket 62 records. The bootstrap now gives that membership up before committing.)
2. **The schema:** dispatch `deploy-db` (Actions → deploy-db → Run workflow, on `main`) with `db_sha` set to the same commit, and approve it in `prod-db`. On a first deploy, the service stays at 0 tasks. The first run took about 5 minutes, most of it the pre-deploy snapshot.

## 7. First app deploy

1. Dispatch `deploy-app` with `app_sha` and approve it in `prod-app`. On the first deploy, it sets the service to 1 task.
2. Check that `https://pensieve.fyi/api/health` answers `200 {"status":"up"}` and that `/` redirects to `/login`.
3. Register your passkey: this creates the admin.
4. Remove the WAF rule from step 4.

## 8. Maintainer-only GitHub steps

These are repository settings no workflow can change.

- **Rulesets:**
  - `protect-develop`: signed commits, no deletion or force-push, a PR with one approval of the latest push, squash merges only, and no required checks.
  - `protect-main`: the same, but merge commits only, and every `ci.yml` check required by name with "branches up to date". The list is on the [CI Pipeline](/architecture/ci-pipeline) page.
  - `protect-release-tags`: `v*` tags can't be deleted or moved.
- **Actions:** allow only GitHub-owned actions. Third-party tools run as digest-pinned images.
- **Security:** secret scanning and push protection on, Dependabot security updates on, and CodeQL default setup for JavaScript/TypeScript and Actions (non-blocking).
- **Semgrep:** the `SEMGREP_APP_TOKEN` repository secret, then the Code and Supply Chain blocking policies in the Semgrep dashboard. Those decide what fails the `semgrep` job.
- **Local hooks:** `brew install trufflehog lefthook && lefthook install` in each clone, so secrets are caught before they're committed.
