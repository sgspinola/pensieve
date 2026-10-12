import path from "node:path";
import { ensureLoggingConfigured, getLogger } from "@/lib/logging";
import { connect } from "./connection";
import { readJournal } from "./journal";
import { checkSchemaCompatibility } from "./schema-check";

/**
 * Ticket 44: runs the startup schema check (./schema-check.ts) once, from
 * src/instrumentation.ts, before the server takes traffic. A failure, or a
 * database it can't reach, exits the process: in ECS the task then never
 * turns healthy and the deployment circuit breaker rolls back (spec 13,
 * "Startup check").
 */

// So an unreachable database fails the boot fast instead of postgres.js's default 30s.
const CONNECT_TIMEOUT_SECONDS = 10;

export async function runStartupSchemaCheck(): Promise<void> {
  await ensureLoggingConfigured();
  const logger = getLogger(["pensieve", "schema-check"]);
  // Relative to the working directory: `/app` in the image (which ships only
  // this journal, no SQL), the repo root locally.
  const journal = readJournal(path.join(process.cwd(), "drizzle"));
  const sql = connect({ max: 1, connect_timeout: CONNECT_TIMEOUT_SECONDS });
  let failure: string | undefined;
  try {
    await checkSchemaCompatibility(sql, journal);
  } catch (error) {
    // The message only: a driver error's full shape can carry connection details.
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    await sql.end();
  }

  if (failure === undefined) {
    logger.info("Database schema is compatible with this app");
    return;
  }
  logger.fatal("Refusing to start: database schema check failed", { reason: failure });
  // Outside production the logger writes only to logs/, so say it where the
  // developer running `next dev` is looking too.
  if (process.env.NODE_ENV !== "production") {
    console.error(`Refusing to start: ${failure}`);
  }
  process.exit(1);
}
