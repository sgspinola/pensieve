import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getLogger } from "@/lib/logging";

const logger = getLogger(["pensieve", "health"]);

// postgres.js waits up to 30s to connect to an unreachable host; a probe
// needs its answer well before its own timeout, so a slow DB counts as down.
const DB_TIMEOUT_MS = 2_000;

/**
 * Ticket 28: readiness probe for the container HEALTHCHECK and the CI e2e
 * job. A trivial `SELECT 1` proves the database is reachable, not just that
 * the process is alive. The proxy exempts exactly this path from the auth
 * gate (see src/proxy.ts), so the response says nothing beyond up/down: a
 * failure's error (which can carry hostnames, ports or a connection string)
 * is only ever logged, never returned.
 *
 * Deliberately not wrapped in withErrorHandling: that turns a throw into a
 * 500 and writes an info line per request, where a probe polled every few
 * seconds wants a 503 and silence while healthy.
 */
export async function GET(): Promise<NextResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Database did not answer within ${DB_TIMEOUT_MS}ms`)), DB_TIMEOUT_MS);
    });
    await Promise.race([getDb().execute(sql`select 1`), timeout]);
    return NextResponse.json({ status: "up" });
  } catch (error) {
    logger.error("Health check failed: database unreachable", { error });
    return NextResponse.json({ status: "down" }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
}
