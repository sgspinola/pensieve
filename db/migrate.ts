import path from "node:path";
import { connect } from "@/db/connection";
import { runMigrations } from "./migrations";

/**
 * Ticket 29, moved to the DB image in ticket 41: the DB image's migration
 * entrypoint (its default command, `docker run <db-image>`). Applies the SQL
 * under `./drizzle` (relative to the working directory: `/app` in the image,
 * the repo root locally) with db/migrations.ts, which needs no dev tooling —
 * `npm run build:db` bundles this file with esbuild. Since ticket 43 it
 * refuses a pending breaking migration unless ALLOW_BREAKING=true. Exits 0
 * on success, non-zero on any failure (a refusal, an unreachable database,
 * bad SQL), having applied nothing.
 */

// So an unreachable DB fails fast instead of postgres.js's default 30s.
const CONNECT_TIMEOUT_SECONDS = 10;

async function main(): Promise<void> {
  // Notices (e.g. "schema already exists, skipping") are noise on a rerun.
  const sql = connect({
    max: 1,
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
    onnotice: () => {},
  });
  try {
    await runMigrations(sql, {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
      allowBreaking: process.env.ALLOW_BREAKING === "true",
    });
  } finally {
    await sql.end();
  }
}

main().then(
  () => console.log("Migrations applied"),
  (error: unknown) => {
    // Messages only: a driver error's full shape can carry connection details.
    console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
