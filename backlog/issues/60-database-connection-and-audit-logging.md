# 60: Database connection and audit logging

**What to build:** After an incident, the maintainer can see who connected to Postgres as which role, failed IAM-auth attempts, and every role, grant or schema change, without user data (note contents) ever reaching the logs. The prod RDS instance gets a parameter group with connection logging and pgaudit, and exports its logs to CloudWatch. The DB bootstrap SQL creates the pgaudit extension. Investigation only, no alerting. There's no spec: the decisions come from the security-logging analysis.

**Blocked by:** 48 (RDS instance). (62, the master lockout that kept the bootstrap from re-running, is done.)

**Status:** in-review: waits on the apply, reboot and bootstrap re-run (item 4)

- [x] Parameter group: `log_connections` and `log_disconnections` on, pgaudit in `shared_preload_libraries`, `pgaudit.log = 'role,ddl'` (no `read` or `write` classes), `log_statement` left off. Ideally this lands before the first real deploy, because changing `shared_preload_libraries` needs a reboot. It landed after the first deploy, so the README's "Database logging" steps switch the group with `--apply-immediately` and reboot (a minute or two of downtime). `shared_preload_libraries` keeps RDS's postgres17 default (`pg_stat_statements,pg_tle`) and adds `pgaudit`
- [x] Log exports `postgresql` and `iam-db-auth-error`, not `upgrade`, into log groups that Terraform creates explicitly with 30-day retention, so RDS can't create them with no expiry
- [x] Bootstrap SQL creates the pgaudit extension idempotently, and only when `pg_available_extensions` lists it: the stock `postgres` image used by DB CI doesn't ship pgaudit. DB CI still passes, and proves the guard skips cleanly. `db/bootstrap.test.ts` checks the skip on stock Postgres: PR #88's `unit` (CI run 38380393910) and `db-grants` (DB run 38379896138) passed
- [ ] Verified by the first real `db-bootstrap` run (tickets 53 and 56): its grant statements appear in the exported pgaudit log, and a deliberately bad IAM token shows up in `iam-db-auth-error`
