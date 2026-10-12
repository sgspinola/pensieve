# 62: The bootstrap locks the RDS master out of password login

**What to build:** Make the DB bootstrap repeatable again, and give the master user back its password login. The first real `db-bootstrap` run (2026-10-12, `sha-3a0ad38`) succeeded. A re-run of the same image then failed with `PAM authentication failed for user "pensieve_master"`. `db/bootstrap.sql` grants `rds_iam` to `pensieve_migrator` (line 30) and then `pensieve_migrator` to the master (`GRANT pensieve_migrator TO CURRENT_USER`, line 34), so the master is an indirect member of `rds_iam`. RDS treats every `rds_iam` member as IAM-only and rejects its password. The first run logged in before the grant existed, then locked the master out for every later login. DB CI's grants test couldn't catch it: its `rds_iam` is a stub role without RDS's PAM behaviour.

The roles, grants and schemas from the first run are in place. `deploy-db` and the app log in with IAM tokens as `pensieve_migrator` and `pensieve_app`, so the deploy path doesn't depend on this ticket. What's broken is re-running the bootstrap (ticket 53's idempotent re-run, ticket 60's pgaudit change) and any use of the master's password, including break-glass access.

Spec: `backlog/specs/13-database-lifecycle.md` (user stories 23–25, "Bootstrap (roles and grants)", "Isolation"); `backlog/specs/11-aws-infrastructure.md` (user story 37, "Database").

**Blocked by:** None (can start immediately)

**Status:** in-review

**Fix going forward.** The master only needs the migrator membership while the bootstrap runs (ticket 42: `ALTER DEFAULT PRIVILEGES FOR ROLE pensieve_migrator` and `ALTER SCHEMA … OWNER TO pensieve_migrator` need it on PG16+). Grant it, do the work, and revoke it in the same transaction (`bootstrap.cjs` already runs the SQL in one). Default privileges and schema ownership outlive the membership, and nothing outside the transaction ever sees the master in `rds_iam`.

**One-time recovery.** The master can't log in with its password, so something must log in as the master to revoke the membership. While the membership stands, the master is an `rds_iam` member, so an IAM token as `pensieve_master` works. Plan:
1. Temporarily give the `pensieve-db-bootstrap` family a task role allowed `rds-db:connect` only as `pensieve_master` (`infra/prod`).
2. Add an opt-in IAM mode to `db/bootstrap.ts`, using the existing helper's IAM mode with `PGUSER=pensieve_master` instead of the injected password.
3. Run the fixed bootstrap once in that mode with `scripts/db-bootstrap.sh`, which revokes the membership on its way out.
4. Remove the temporary role and the IAM mode, then confirm a normal password-mode re-run works.

Considered and set aside: resetting the master password through RDS (AWS documents it as restoring the master's own privileges, not as removing role memberships it holds), and leaving the master IAM-only for good (it would need a master-capable IAM path forever, against spec 11 user story 37's "only the bootstrap task").

- [x] `db/bootstrap.sql` revokes the master's `pensieve_migrator` membership at the end of the same transaction that grants it, and stays idempotent. A comment explains the RDS PAM rule, so the grant isn't "simplified" back
- [x] The grants test (`db/bootstrap.test.ts`) asserts the bootstrapping user ~~is no longer a member of `pensieve_migrator`, directly or through another role~~ holds none of `pensieve_migrator`'s (or `rds_iam`'s) privileges after a run, keeping only the automatic admin-only membership Postgres 16+ grants a role's creator (revised: the master can't revoke that one; see the implementation notes). It still asserts the default privileges and schema ownership the membership was needed for
- [ ] The one-time recovery above runs, and its temporary task role and IAM mode are removed again (the Terraform apply that removes them leaves no `rds-db:connect` as `pensieve_master` anywhere)
- [ ] Verified on prod: a normal password-mode `scripts/db-bootstrap.sh` run succeeds, and a second run right after it succeeds too, which closes ticket 53's last item
- [x] Docs: the "Roles and grants" section of `docs/architecture/database-schema.md` and the bootstrap notes in `infra/prod/README.md` explain the temporary membership

**Implementation notes:**
- Phase 1 (this branch):
  - **SQL:** `db/bootstrap.sql` ends with `REVOKE pensieve_migrator FROM CURRENT_USER`.
  - **Grants test:** its stub `rds_iam` is now granted to the test master admin-only (`INHERIT FALSE, SET FALSE`), like RDS's master, which could log in with a password before the first bootstrap. Three new tests: the master doesn't inherit `rds_iam`; its only remaining membership in the migrator is the automatic admin-only one; a master left holding the old grant (prod's state) gives it up on the next run.
  - **IAM mode:** `db/bootstrap-auth.ts` selects it with `BOOTSTRAP_AUTH=iam`.
  - **Terraform:** a temporary `pensieve-db-bootstrap-task` role, allowed `rds-db:connect` only as the master, and `BOOTSTRAP_AUTH=iam` on the bootstrap task definition.
- Then: release to `main` (the fix ships in the DB image), apply, and run `scripts/db-bootstrap.sh <release sha>` once. It logs in over IAM and revokes the membership.
- **Open question this run settles.** On Postgres 16+, creating a role as a `CREATEROLE` user grants the creator an automatic admin-only membership in it (ADMIN, no INHERIT, no SET), recorded as granted by the superuser. The master can't revoke it (checked locally on 17.11: `permission denied to revoke privileges granted by role …`). After the fix, the master still *belongs* to `pensieve_migrator`, and through it to `rds_iam`, but no longer holds their privileges (`pg_has_role(..., 'USAGE')` is false). AWS says `rds_iam` "directly or indirectly by nested grant access" makes a role IAM-only, and doesn't say whether an admin-only membership counts.
  - If a password-mode run works after the recovery: phase 2 removes the temporary role, `BOOTSTRAP_AUTH` and the IAM mode, as planned.
  - If it doesn't: the master stays IAM-only on this database, because no master-created role design avoids that membership. The bootstrap would then keep its task role and IAM mode for good and drop the master-secret injection. That's the option this ticket set aside, and the maintainer's call.
