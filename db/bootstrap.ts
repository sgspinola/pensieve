import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "@/db/connection";

/**
 * Ticket 42: the DB image's bootstrap entrypoint (`docker run <db-image>
 * bootstrap.cjs`), which creates the database roles and grants by running
 * db/bootstrap.sql as the RDS master user. In AWS it runs only as the
 * one-off bootstrap task, whose task definition injects PGUSER and
 * PGPASSWORD from the RDS-managed master secret; locally and in CI,
 * DATABASE_URL wins as usual. The SQL is read from `./db/bootstrap.sql`
 * (relative to the working directory: `/app` in the image, the repo root
 * locally). It runs in one transaction, so a failure changes nothing. Exits
 * 0 on success, non-zero on any failure.
 */

// So an unreachable DB fails fast instead of postgres.js's default 30s.
const CONNECT_TIMEOUT_SECONDS = 10;

async function main(): Promise<void> {
  const bootstrapSql = readFileSync(path.join(process.cwd(), "db", "bootstrap.sql"), "utf8");
  // Notices (e.g. "role is already a member") are noise on a rerun.
  const sql = connect({ max: 1, connect_timeout: CONNECT_TIMEOUT_SECONDS, onnotice: () => {} }, "password");
  try {
    await sql.begin((tx) => tx.unsafe(bootstrapSql));
  } finally {
    await sql.end();
  }
}

main().then(
  () => console.log("Bootstrap applied"),
  (error: unknown) => {
    // Messages only: a driver error's full shape can carry connection details.
    console.error(`Bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
