# 62: The bootstrap locks the RDS master out of password login

**What to build:** Make the DB bootstrap repeatable again, and give the master user back its password login. The first real `db-bootstrap` run (2026-10-12, `sha-3a0ad38`) succeeded. A re-run of the same image then failed with `PAM authentication failed for user "pensieve_master"`. `db/bootstrap.sql` grants `rds_iam` to `pensieve_migrator` (line 30) and then `pensieve_migrator` to the master (`GRANT pensieve_migrator TO CURRENT_USER`, line 34), so the master is an indirect member of `rds_iam`. RDS treats every `rds_iam` member as IAM-only and rejects its password. The first run logged in before the grant existed, then locked the master out for every later login. DB CI's grants test couldn't catch it: its `rds_iam` is a stub role without RDS's PAM behaviour.

The roles, grants and schemas from the first run are in place. `deploy-db` and the app log in with IAM tokens as `pensieve_migrator` and `pensieve_app`, so the deploy path doesn't depend on this ticket. What's broken is re-running the bootstrap (ticket 53's idempotent re-run, ticket 60's pgaudit change) and any use of the master's password, including break-glass access.

Spec: `backlog/specs/13-database-lifecycle.md` (user stories 23–25, "Bootstrap (roles and grants)", "Isolation"); `backlog/specs/11-aws-infrastructure.md` (user story 37, "Database").

**Blocked by:** None (can start immediately)

**Status:** in-review

**Fix going forward.** The master only needs the migrator membership while the bootstrap runs (ticket 42: `ALTER DEFAULT PRIVILEGES FOR ROLE pensieve_migrator` and `ALTER SCHEMA … OWNER TO pensieve_migrator` need it on PG16+). Grant it, do the work, and revoke it in the same transaction (`bootstrap.cjs` already runs the SQL in one). Default privileges and schema ownership outlive the membership, and nothing outside the transaction ever sees the master in `rds_iam`.

**One-time recovery** (revised before running: the maintainer chose a local script over the Terraform and IAM-mode path, and kept it out of the repository). The master can't log in with its password. But the admin user can sign an IAM token for it locally (`aws rds generate-db-auth-token`; `AdministratorAccess` includes `rds-db:connect`), which works while the master is an `rds_iam` member. RDS is private, so the SQL runs as a one-off ECS task in the service's subnet and security group:
- **Task:** a temporary `pensieve-db-recover-master` task definition: `postgres:17-alpine` pinned by CI's digest, the bootstrap's execution role (reads the master secret, writes `/ecs/pensieve-db-bootstrap`), no task role.
- **Token:** passed as an environment override. It's valid for 15 minutes, and RunTask overrides show up in CloudTrail; that's accepted for a one-off.
- **What it runs:** `psql` over verified TLS (the RDS CA bundle). It issues `REVOKE pensieve_migrator FROM pensieve_master`, reports `pg_has_role(..., 'rds_iam', 'USAGE' / 'MEMBER')`, then tries `SELECT 1` with the master password.
- **Cleanup:** the task definition is deregistered afterwards.

No Terraform change, image or release is needed.

Considered and set aside: resetting the master password through RDS (AWS documents it as restoring the master's own privileges, not as removing role memberships it holds); a temporary Terraform task role plus an IAM mode in `bootstrap.ts` (needs a release and an apply in, then another to take them out); and leaving the master IAM-only for good (it would need a master-capable IAM path forever, against spec 11 user story 37's "only the bootstrap task").

- [x] `db/bootstrap.sql` revokes the master's `pensieve_migrator` membership at the end of the same transaction that grants it, and stays idempotent. A comment explains the RDS PAM rule, so the grant isn't "simplified" back
- [x] The grants test (`db/bootstrap.test.ts`) asserts the bootstrapping user ~~is no longer a member of `pensieve_migrator`, directly or through another role~~ holds none of `pensieve_migrator`'s (or `rds_iam`'s) privileges after a run, keeping only the automatic admin-only membership Postgres 16+ grants a role's creator (revised: the master can't revoke that one; see the implementation notes). It still asserts the default privileges and schema ownership the membership was needed for
- [x] The one-time recovery above runs: the `REVOKE` succeeds, the master no longer holds `rds_iam`'s privileges, and its temporary task definition is deregistered. Ran on 2026-10-12 (task `fe44870f654345248f345f9b71e0c6c4`, log `/ecs/pensieve-db-bootstrap`, stream `db_recover/recover/…`). It printed `REVOKE ROLE`, then `rds_iam` USAGE false and MEMBER false, no memberships left in `pensieve_migrator`, and "password login works". `pensieve-db-recover-master:1` was deregistered
- [ ] Verified on prod: a normal password-mode `scripts/db-bootstrap.sh` run succeeds, and a second run right after it succeeds too, which closes ticket 53's last item
- [x] Docs: the "Roles and grants" section of `docs/architecture/database-schema.md` and the bootstrap notes in `infra/prod/README.md` explain the temporary membership

**Implementation notes:**
- **The fix:** `db/bootstrap.sql` ends with `REVOKE pensieve_migrator FROM CURRENT_USER`.
- **Grants test:**
  - its stub `rds_iam` is granted to the test master admin-only (`INHERIT FALSE, SET FALSE`), like RDS's master, which could log in with a password before the first bootstrap
  - three new tests: the master doesn't inherit `rds_iam`; its only remaining membership in the migrator is the automatic admin-only one; a master left holding the old grant (prod's state) gives it up on the next run
  - removing the `REVOKE` fails all three
- **Open question, settled by the recovery: RDS keeps no admin-only membership.** After the `REVOKE`, prod's master held no membership in `pensieve_migrator` at all, and wasn't an `rds_iam` member, even by `MEMBER`. So RDS's master doesn't get Postgres 16+'s automatic admin grant on the roles it creates, and the fix alone restores the password login. The grants test still expects that grant, because it runs on vanilla Postgres, where it exists. The original note follows.
- **Open question (as written before the recovery).** On Postgres 16+, creating a role as a `CREATEROLE` user grants the creator an automatic admin-only membership in it (ADMIN, no INHERIT, no SET), recorded as granted by the superuser. The master can't revoke it (checked locally on 17.11: `permission denied to revoke privileges granted by role …`). After the `REVOKE`, the master still *belongs* to `pensieve_migrator`, and through it to `rds_iam`, but holds none of their privileges (`pg_has_role(..., 'USAGE')` is false). AWS says `rds_iam` "directly or indirectly by nested grant access" makes a role IAM-only, and doesn't say whether an admin-only membership counts. The recovery's password `SELECT 1` answers it:
  - **If it works:** release the fixed image, then two `db-bootstrap.sh` runs close this ticket and ticket 53's re-run.
  - **If it fails with PAM:** the master stays IAM-only on this database, because no master-created role design avoids that membership. The bootstrap would then need a permanent IAM login for the master: the maintainer's call.
- **Until the fix is released,** don't run `db-bootstrap.sh` with `3a0ad38`'s image: its SQL would re-grant the membership.
