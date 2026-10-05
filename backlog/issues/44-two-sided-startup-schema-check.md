# 44: Two-sided startup schema check

**What to build:** The app refuses to start against a schema it can't handle, so ECS's circuit breaker rolls back a deploy in the wrong order. At boot the app reads Drizzle's bookkeeping table and `pensieve_meta.schema_compat`, and compares them with the migration journal bundled in its image. It exits with an error when the database is too old (a journal tag isn't applied) or the app is too old (the newest breaking migration in the database isn't in its journal). A database ahead only by additive migrations is fine. Spec: `backlog/specs/13-database-lifecycle.md` (user stories 9–11; "Startup check"); `backlog/specs/11-aws-infrastructure.md` (user story 41).

**Blocked by:** 42 (app role `SELECT` grants), 43 (`schema_compat` table)

**Status:** ready-for-agent

- [ ] The check runs once at app startup, before the app serves traffic, and a failure exits the process with a clear logged reason
- [ ] It accepts an exact match and a database ahead only by additive migrations
- [ ] It rejects a missing journal tag (DB too old) and a newer breaking migration (app too old)
- [ ] Vitest tests (database seam) cover all four cases from a given journal and database state
- [ ] Local dev, unit CI and e2e (which migrate with drizzle-kit and have no `pensieve_meta`) still start. How a missing `schema_compat` is treated is decided and tested
- [ ] `docs/flows/` updated for the startup flow
