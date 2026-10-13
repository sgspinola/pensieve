# 45: Schema drift and upgrade-path checks in DB CI

**What to build:** DB CI tests the real production upgrade path and catches a forgotten `drizzle-kit generate`. A `db-drift` job runs `drizzle-kit generate` and fails if it produces any new file. It needs no database. `db-apply` gains an upgrade-path step: apply the previous `main` commit's `drizzle/` with drizzle-kit, then run the built DB image's migrator on top with `ALLOW_BREAKING=true`. Spec: `backlog/specs/13-database-lifecycle.md` (user stories 14, 15; `db.yml` jobs).

**Blocked by:** 43 (migrator with `ALLOW_BREAKING`)

**Status:** done

**Completed:** on `feat/45-db-ci-drift-and-upgrade-path`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/92

- [x] `db-drift` fails when `schema.ts` and the committed snapshots disagree, and passes when they agree. The hand-added breaking marker doesn't affect it. Verified in draft PR #93: a `schema.ts`-only commit failed it (DB run 38392996650), and with its generated migration it passed (DB run 38393379248). PR #92's own run passed it on the unchanged schema (DB run 38392970144)
- [x] `db-apply` upgrade step applies the previous `main` commit's migrations, then the image's migrator, with `ALLOW_BREAKING=true`. `.github/scripts/db-upgrade-path.sh`, in a second database on the job's Postgres service. The base is `main`, or on a push to `main`, `github.event.before`
- [x] ~~Both run on every change and are added by name to the `develop`/`main` rulesets' required checks~~ (revised: spec 13, as revised during ticket 41, keeps every `db.yml` job advisory, because the workflow is path-filtered and a required check whose workflow never triggered would block every app-only PR. Both jobs run on every change to a DB input, like the other `db.yml` jobs, and `publish-db` needs `db-drift`)
- [x] Verified by a PR that edits `schema.ts` without generating (drift fails) and one with a real new migration (upgrade passes). Draft PR #93, stacked on #92 and closed after: `e7101d5` (schema only) failed `db-drift`; `17f7826` (its generated migration) passed it, and `db-apply`'s upgrade went from `main`'s `7501f1c` (13 migrations, drizzle-kit) to 14 with the DB image
