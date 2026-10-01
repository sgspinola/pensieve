/**
 * Ticket 29: the container image's HEALTHCHECK command. Distroless has no
 * `curl`, so this calls the health endpoint (src/app/api/health/route.ts)
 * with Node's own fetch: exit 0 on a 2xx, 1 on a 503, a timeout or a refused
 * connection.
 */

// Leaves room for the endpoint's own 2s DB timeout to answer with a 503,
// and still fits inside the Dockerfile's HEALTHCHECK --timeout=5s.
const PROBE_TIMEOUT_MS = 4_000;
const port = process.env.PORT ?? "3000";

fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }).then(
  (response) => {
    process.exitCode = response.ok ? 0 : 1;
  },
  () => {
    process.exitCode = 1;
  },
);
