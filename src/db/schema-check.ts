import type postgres from "postgres";
import type { Journal } from "./journal";

/**
 * Ticket 44: the app's two-sided startup schema check (spec 13, "Startup
 * check"; spec 11, user story 41). Compares the migration journal the app
 * was built with against what the database has applied, and throws, naming
 * the migrations involved, when the app can't run on it:
 *
 *  - database too old: a journal migration isn't recorded in Drizzle's
 *    bookkeeping table (the app was deployed before its migration);
 *  - app too old: `pensieve_meta.schema_compat` names a breaking migration
 *    the journal lacks (an older app restarted on a newer, broken schema).
 *
 * A database ahead only by additive migrations passes: those don't move
 * `schema_compat`. When `schema_compat` is missing, no breaking migration is
 * on record, so only the first side applies. Only the DB image's migrator
 * (ticket 43) creates it; drizzle-kit, which local dev, unit CI and e2e
 * migrate with, never does. In AWS the migrator creates it in the same
 * transaction as its first batch, so it can't be missing there while the
 * migrations are applied.
 *
 * Reads only, so the app role's SELECT grants (ticket 42) are enough.
 */
export async function checkSchemaCompatibility(sql: postgres.Sql, journal: Journal): Promise<void> {
  // A bookkeeping row's created_at is its journal entry's `when` (ticket 43).
  const applied = new Set(
    (await tableExists(sql, "drizzle.__drizzle_migrations"))
      ? (await sql<{ created_at: string }[]>`select created_at from drizzle.__drizzle_migrations`).map((row) =>
          Number(row.created_at),
        )
      : [],
  );
  const missing = journal.entries.filter((entry) => !applied.has(entry.when)).map((entry) => entry.tag);
  if (missing.length > 0) {
    throw new Error(
      `database is too old for this app, which expects migration(s) it hasn't applied: ${missing.join(", ")}. ` +
        "Deploy the database first (locally: `npm run db:migrate`).",
    );
  }

  const [compat] = (await tableExists(sql, "pensieve_meta.schema_compat"))
    ? await sql<{ breaking_tag: string | null }[]>`select breaking_tag from pensieve_meta.schema_compat`
    : [];
  const breakingTag = compat?.breaking_tag ?? null;
  if (breakingTag !== null && !journal.entries.some((entry) => entry.tag === breakingTag)) {
    throw new Error(
      `app is too old for this database, which holds a breaking migration it doesn't know: ${breakingTag}. ` +
        "Deploy the app version that expects it.",
    );
  }
}

async function tableExists(sql: postgres.Sql, name: string): Promise<boolean> {
  const [{ exists }] = await sql<{ exists: boolean }[]>`select to_regclass(${name}) is not null as exists`;
  return exists;
}
