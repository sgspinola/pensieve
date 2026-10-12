# 45: Schema drift and upgrade-path checks in DB CI

**What to build:** DB CI tests the real production upgrade path and catches a forgotten `drizzle-kit generate`. A `db-drift` job runs `drizzle-kit generate` and fails if it produces any new file. It needs no database. `db-apply` gains an upgrade-path step: apply the previous `main` commit's `drizzle/` with drizzle-kit, then run the built DB image's migrator on top with `ALLOW_BREAKING=true`. Spec: `backlog/specs/13-database-lifecycle.md` (user stories 14, 15; `db.yml` jobs).

**Blocked by:** 43 (migrator with `ALLOW_BREAKING`)

**Status:** ready-for-agent

- [ ] `db-drift` fails when `schema.ts` and the committed snapshots disagree, and passes when they agree. The hand-added breaking marker doesn't affect it
- [ ] `db-apply` upgrade step applies the previous `main` commit's migrations, then the image's migrator, with `ALLOW_BREAKING=true`
- [ ] Both run on every change and are added by name to the `develop`/`main` rulesets' required checks
- [ ] Verified by a PR that edits `schema.ts` without generating (drift fails) and one with a real new migration (upgrade passes)
