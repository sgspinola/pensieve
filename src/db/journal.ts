import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * drizzle-kit's migration journal, `<migrations folder>/meta/_journal.json`:
 * the ordered list of migrations a build was generated with. The DB image's
 * migrator (ticket 43) reads it beside the SQL; the app image ships it alone
 * (ticket 41) for the startup schema check (ticket 44).
 */
export interface JournalEntry {
  tag: string;
  /** Also the `created_at` drizzle records for the migration when it applies it. */
  when: number;
}

export interface Journal {
  entries: JournalEntry[];
}

export function readJournal(migrationsFolder: string): Journal {
  return JSON.parse(readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8"));
}
