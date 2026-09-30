/**
 * Exists solely so Playwright (e2e/error-boundary.spec.ts, ticket 08) can
 * force a real render crash inside the `/wiki` segment and prove
 * src/app/wiki/error.tsx's local fallback catches it while WikiLayout's
 * sidebar shell stays mounted — not reachable from any nav or link.
 * Always throws; renders nothing on its own.
 */
export default function WikiErrorBoundaryTestPage(): never {
  throw new Error("Boom: intentional crash for e2e/error-boundary.spec.ts (ticket 08)");
}
