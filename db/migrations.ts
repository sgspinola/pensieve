import { readFileSync } from "node:fs";
import path from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type postgres from "postgres";

/**
 * Ticket 43: the DB image's migrator (spec 13, "Migrator behaviour").
 *
 * It applies the migrations exactly as drizzle-orm's migrator does (same SQL
 * split on `--> statement-breakpoint`, same rows in Drizzle's bookkeeping
 * table, so drizzle-kit and this migrator agree on what's applied), but in a
 * transaction it owns. That way the breaking-migration check, the
 * migrations and the `pensieve_meta.schema_compat` update commit or roll
 * back together. drizzle's own `migrate()` opens a transaction of its own,
 * which can't be nested inside another.
 */

/** A migration is breaking when its SQL file's first line is exactly this. */
export const BREAKING_MARKER = "-- pensieve:breaking";

export interface RunMigrationsOptions {
  migrationsFolder: string;
  /** ALLOW_BREAKING=true: deploy-db (ticket 54) will set it only when an app version is supplied. */
  allowBreaking: boolean;
}

export async function runMigrations(sql: postgres.Sql, options: RunMigrationsOptions): Promise<void> {
  const journal: { entries: { tag: string }[] } = JSON.parse(
    readFileSync(path.join(options.migrationsFolder, "meta", "_journal.json"), "utf8"),
  );
  // readMigrationFiles returns one entry per journal entry, in journal order.
  const migrations = readMigrationFiles({ migrationsFolder: options.migrationsFolder }).map((m, i) => ({
    ...m,
    tag: journal.entries[i].tag,
    breaking: m.sql[0].split("\n", 1)[0].trim() === BREAKING_MARKER,
  }));

  await sql.begin(async (tx) => {
    await tx`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await tx`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `;
    // drizzle's rule: a migration is pending when it's newer than the newest
    // one recorded.
    const [last] = await tx<{ created_at: string }[]>`
      select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1
    `;
    const pending = migrations.filter((m) => !last || Number(last.created_at) < m.folderMillis);

    const breakingTags = pending.filter((m) => m.breaking).map((m) => m.tag);
    if (breakingTags.length > 0 && !options.allowBreaking) {
      throw new Error(
        `breaking migration(s) pending: ${breakingTags.join(", ")}. Nothing was applied. A breaking migration ` +
          "deploys only with the app version that expects it (ALLOW_BREAKING=true).",
      );
    }

    for (const migration of pending) {
      for (const statement of migration.sql) {
        await tx.unsafe(statement);
      }
      await tx`
        insert into drizzle.__drizzle_migrations (hash, created_at)
        values (${migration.hash}, ${migration.folderMillis})
      `;
    }

    await tx`CREATE SCHEMA IF NOT EXISTS pensieve_meta`;
    await tx`
      CREATE TABLE IF NOT EXISTS pensieve_meta.schema_compat (
        id boolean PRIMARY KEY DEFAULT true CHECK (id),
        breaking_tag text
      )
    `;
    // The newest breaking migration ever applied. After a batch, every
    // journal entry is applied, so it's the journal's newest breaking one,
    // even if another migrator (drizzle-kit ignores the marker) applied it.
    // With nothing pending the database may be ahead of this journal, so the
    // recorded tag stays; it also stays when the journal has no breaking one.
    const newestBreaking = pending.length > 0 ? (migrations.findLast((m) => m.breaking)?.tag ?? null) : null;
    await tx`
      insert into pensieve_meta.schema_compat (breaking_tag) values (${newestBreaking})
      on conflict (id) do update set breaking_tag = coalesce(excluded.breaking_tag, schema_compat.breaking_tag)
    `;
  });
}
