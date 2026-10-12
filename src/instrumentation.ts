/**
 * Next.js calls `register` once per server instance, and the server takes no
 * requests until it resolves (node_modules/next/dist/docs/01-app/02-guides/
 * instrumentation.md). Ticket 44 uses it for the startup schema check, which
 * exits the process when the database and this build can't work together.
 * It needs Node (postgres.js, the filesystem), so it's imported only in the
 * Node.js runtime, as the guide recommends.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runStartupSchemaCheck } = await import("./db/startup-check");
    await runStartupSchemaCheck();
  }
}
