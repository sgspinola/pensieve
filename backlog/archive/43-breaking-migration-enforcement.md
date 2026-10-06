# 43: Breaking-migration marker enforced by the migrator

**What to build:** Breaking schema changes can't slip into a deploy that isn't ready for them. A migration whose SQL file's first line is `-- pensieve:breaking` is breaking; everything else is additive. Before applying, the DB image's migrator works out the pending migrations from the bundled journal and Drizzle's bookkeeping table. If any pending migration is breaking and `ALLOW_BREAKING` isn't `true`, it exits non-zero naming them and applies nothing. In the same transaction as a successful apply, it upserts the single-row `pensieve_meta.schema_compat` table with the tag of the newest breaking migration ever applied. Spec: `backlog/specs/13-database-lifecycle.md` (user stories 5–8; "Breaking-migration marker", "Migrator behaviour").

**Blocked by:** 42 (`pensieve_meta` schema and migrator ownership)

**Status:** done

**Completed:** on `feat/43-breaking-migration-enforcement`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/40

- [x] Migrator detects pending migrations by comparing the bundled journal with the bookkeeping table
- [x] A pending breaking migration without `ALLOW_BREAKING=true` makes it exit non-zero with a message naming the breaking migrations, and nothing from the batch is applied
- [x] With `ALLOW_BREAKING=true` it applies the batch and records the newest breaking tag in `pensieve_meta.schema_compat` in the same transaction (null when none has ever been applied)
- [x] A failure part-way through leaves the schema unchanged
- [x] Vitest migrator tests against a test database and a fixture migrations folder cover: additive applies, breaking refused with nothing applied, breaking allowed and recorded
- [x] The marker and the additive/breaking rule of thumb are documented for developers (README or the relevant `docs/` page; the deploy runbook is ticket 56)

**Implementation notes:**
- `db/migrations.ts` (`runMigrations`) applies the migrations itself, using drizzle-orm's `readMigrationFiles` and writing drizzle's bookkeeping rows, rather than calling drizzle's `migrate()`, whose own transaction can't be nested. That way the breaking check, the apply and the `schema_compat` upsert share one transaction. Re-check it against `drizzle-orm/pg-core/dialect.js` `migrate()` on drizzle-orm upgrades.
- After a batch, `schema_compat` records the journal's newest breaking tag, so one applied by drizzle-kit (which ignores the marker) is still recorded. With nothing pending, the tag is left alone, since the database may be ahead of the image.
- `ALLOW_BREAKING` must be exactly `true`. The marker is matched on the trimmed first line of the SQL file.
- Verified with the built DB image: real migrations apply in either order with drizzle-kit, and the `v2` fixture is refused, then applied with `ALLOW_BREAKING=true`.
