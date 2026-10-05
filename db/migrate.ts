import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connect } from "@/db/connection";

/**
 * Ticket 29, moved to the DB image in ticket 41: the DB image's migration
 * entrypoint (its default command, `docker run <db-image>`). Uses
 * drizzle-orm's built-in migrator rather than drizzle-kit, so the image needs
 * no dev tooling — `npm run build:db` bundles this file with esbuild. Applies
 * the SQL under `./drizzle` (relative to the working directory: `/app` in the
 * image, the repo root locally) and exits 0 on success, non-zero on any
 * failure, including an unreachable database.
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
    await migrate(drizzle(sql), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  } finally {
    await sql.end();
  }
}

main().then(
  () => console.log("Migrations applied"),
  (error: unknown) => {
    // Messages only: a driver error's full shape can carry connection details.
    // drizzle wraps the driver's error ("Failed query: …"), so the cause's
    // message is the one that says *why* (e.g. "getaddrinfo ENOTFOUND db").
    const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
    console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}${cause}`);
    process.exitCode = 1;
  },
);
