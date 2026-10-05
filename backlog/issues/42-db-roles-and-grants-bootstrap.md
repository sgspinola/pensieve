# 42: Idempotent roles-and-grants bootstrap

**What to build:** The least-privilege database role model exists as code. An idempotent, additive bootstrap SQL script creates the migrator and app roles if they're missing, grants `rds_iam`, creates the `pensieve_meta` schema owned by the migrator, gives the app role CRUD on tables and `USAGE` on sequences through `ALTER DEFAULT PRIVILEGES FOR ROLE <migrator>`, and gives the app role `SELECT` on Drizzle's bookkeeping table and on `pensieve_meta`. The DB image gains a `bootstrap.cjs` entrypoint that runs it as the RDS master user, and DB CI proves the grants work. Spec: `backlog/specs/13-database-lifecycle.md` (user stories 16, 24; "Bootstrap (roles and grants)"; grants test under Testing Decisions).

**Blocked by:** 41 (DB image and `db.yml`)

**Status:** ready-for-agent

- [ ] Bootstrap SQL is idempotent: running it twice succeeds and changes nothing the second time. Removing a grant is documented as needing an explicit `REVOKE`
- [ ] DB image ships `bootstrap.cjs`, which connects as the master user using the RDS-managed master secret (via the shared helper with a secret instead of a token) and runs the SQL
- [ ] Vitest grants test (on the `createTestDb` harness, with a stub `rds_iam` role): run bootstrap, migrate as the migrator, then connect as the app role
- [ ] The test asserts the app role can select, insert, update and delete in a migrated table, and is refused DDL
- [ ] The test asserts the app role can still write a table the migrator creates *after* bootstrap
- [ ] The test asserts the app role can read the bookkeeping table and `pensieve_meta` but not write them
- [ ] `db-grants` job in `db.yml` runs that test (on `db.yml`'s path-filtered triggers; not a required check, see spec 13)
