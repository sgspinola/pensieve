# 42: Idempotent roles-and-grants bootstrap

**What to build:** The least-privilege database role model exists as code. An idempotent, additive bootstrap SQL script creates the migrator and app roles if they're missing, grants `rds_iam`, creates the `pensieve_meta` schema owned by the migrator, gives the app role CRUD on tables and `USAGE` on sequences through `ALTER DEFAULT PRIVILEGES FOR ROLE <migrator>`, and gives the app role `SELECT` on Drizzle's bookkeeping table and on `pensieve_meta`. The DB image gains a `bootstrap.cjs` entrypoint that runs it as the RDS master user, and DB CI proves the grants work. Spec: `backlog/specs/13-database-lifecycle.md` (user stories 16, 24; "Bootstrap (roles and grants)"; grants test under Testing Decisions).

**Blocked by:** 41 (DB image and `db.yml`)

**Status:** done

**Completed:** on `feat/42-db-roles-and-grants-bootstrap`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/37

- [x] Bootstrap SQL is idempotent: running it twice succeeds and changes nothing the second time. Removing a grant is documented as needing an explicit `REVOKE`
- [x] DB image ships `bootstrap.cjs`, which connects as the master user using the RDS-managed master secret (via the shared helper with a secret instead of a token) and runs the SQL
- [x] Vitest grants test (on the `createTestDb` harness, with a stub `rds_iam` role): run bootstrap, migrate as the migrator, then connect as the app role
- [x] The test asserts the app role can select, insert, update and delete in a migrated table, and is refused DDL
- [x] The test asserts the app role can still write a table the migrator creates *after* bootstrap
- [x] The test asserts the app role can read the bookkeeping table and `pensieve_meta` but not write them
- [x] `db-grants` job in `db.yml` runs that test (on `db.yml`'s path-filtered triggers; not a required check, see spec 13)

**Implementation notes:**
- Roles are `pensieve_migrator` and `pensieve_app`. The master password reaches `bootstrap.cjs` as `PGUSER`/`PGPASSWORD`, which the bootstrap task definition (ticket 49) must inject from the RDS-managed secret's `username`/`password` JSON keys. It's read by `connect(…, "password")` in `src/db/connection.ts`, still over verified TLS.
- Beyond spec 13's list, the migrator gets `CREATE` on the database: drizzle-orm's migrator runs `CREATE SCHEMA IF NOT EXISTS drizzle`, which Postgres refuses without it even when the schema exists (verified by removing the grant).
- The bootstrap first grants the master membership of `pensieve_migrator`: on PG16+, a `CREATEROLE` user gets only ADMIN on roles it creates, not the privileges `ALTER DEFAULT PRIVILEGES FOR ROLE` and `ALTER SCHEMA … OWNER TO` need.
- The grants test assumes each role with `SET ROLE` on one superuser connection rather than logging in (the roles are IAM-only). Roles are cluster-wide, so it drops `pensieve_app`, `pensieve_migrator` and the stub `rds_iam` before and after it runs: point it only at a test Postgres. `ci.yml`'s `unit` job runs it too, since Vitest now includes `db/**`.
