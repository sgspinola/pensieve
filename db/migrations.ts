import { readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type postgres from "postgres";

/**
 * Ticket 43: the DB image's migrator (spec 13, "Migrator behaviour").
 *
 * drizzle-orm's own `migrate()` decides what's pending and applies it, but
 * inside a transaction this function owns, so the breaking-migration check
 * and the `pensieve_meta.schema_compat` update commit or roll back together
 * with the migrations. The check runs after `migrate()`, on the rows it
 * added to Drizzle's bookkeeping table: a refused batch is rolled back, so
 * nothing is applied.
 */

/** A migration is breaking when its SQL file's first line is exactly this. */
export const BREAKING_MARKER = "-- pensieve:breaking";

export interface RunMigrationsOptions {
  migrationsFolder: string;
  /** ALLOW_BREAKING=true: deploy-db (ticket 54) will set it only when an app version is supplied. */
  allowBreaking: boolean;
}

interface JournalEntry {
  tag: string;
  /** Also the `created_at` drizzle records for the migration when it applies it. */
  when: number;
}

export async function runMigrations(sql: postgres.Sql, options: RunMigrationsOptions): Promise<void> {
  const journal: { entries: JournalEntry[] } = JSON.parse(
    readFileSync(path.join(options.migrationsFolder, "meta", "_journal.json"), "utf8"),
  );
  const isBreaking = (entry: JournalEntry) =>
    readFileSync(path.join(options.migrationsFolder, `${entry.tag}.sql`), "utf8").split("\n", 1)[0].trim() ===
    BREAKING_MARKER;

  await sql.begin(async (tx) => {
    const before = await newestRecorded(tx);
    await migrate(drizzleInTransaction(sql, tx), { migrationsFolder: options.migrationsFolder });
    const appliedAt = new Set(
      (
        await tx<{ created_at: string }[]>`
          select created_at from drizzle.__drizzle_migrations
          where ${before === null ? tx`true` : tx`created_at > ${before}`}
        `
      ).map((row) => Number(row.created_at)),
    );
    const applied = journal.entries.filter((entry) => appliedAt.has(entry.when));

    const breakingTags = applied.filter(isBreaking).map((entry) => entry.tag);
    if (breakingTags.length > 0 && !options.allowBreaking) {
      // Throwing rolls back the whole transaction, migrate()'s work included.
      throw new Error(
        `breaking migration(s) pending: ${breakingTags.join(", ")}. Nothing was applied. A breaking migration ` +
          "deploys only with the app version that expects it (ALLOW_BREAKING=true).",
      );
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
    // With nothing applied the database may be ahead of this journal, so the
    // recorded tag stays; it also stays when the journal has no breaking one.
    const newestBreaking = applied.length > 0 ? (journal.entries.findLast(isBreaking)?.tag ?? null) : null;
    await tx`
      insert into pensieve_meta.schema_compat (breaking_tag) values (${newestBreaking})
      on conflict (id) do update set breaking_tag = coalesce(excluded.breaking_tag, schema_compat.breaking_tag)
    `;
  });
}

/** The newest `created_at` in Drizzle's bookkeeping table; null before the first migration. */
async function newestRecorded(tx: postgres.TransactionSql): Promise<string | null> {
  const [{ exists }] = await tx<{ exists: boolean }[]>`
    select to_regclass('drizzle.__drizzle_migrations') is not null as exists
  `;
  if (!exists) return null;
  const [{ newest }] = await tx<
    { newest: string | null }[]
  >`select max(created_at) as newest from drizzle.__drizzle_migrations`;
  return newest;
}

/**
 * A drizzle client on the open transaction `tx`. drizzle's postgres-js
 * session runs `migrate()` in `client.begin()`, which a postgres.js
 * transaction doesn't have (it can't nest), so `begin` becomes a savepoint;
 * drizzle also reads the client's `options` (type parsers), which only the
 * top-level client carries. Those two driver details are what this relies
 * on: the migrator tests fail if a drizzle-orm upgrade changes them.
 */
function drizzleInTransaction(sql: postgres.Sql, tx: postgres.TransactionSql) {
  const client = Object.assign(tx, {
    begin: (fn: (savepoint: postgres.TransactionSql) => unknown) => tx.savepoint(fn),
    options: sql.options,
  });
  return drizzle(client as unknown as postgres.Sql);
}
