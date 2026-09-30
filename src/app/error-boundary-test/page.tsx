/**
 * Exists solely so Playwright (e2e/error-boundary.spec.ts, ticket 08) can
 * force a real render crash and prove src/app/error.tsx's fallback actually
 * renders after render/hydration — not reachable from any nav or link.
 * Always throws; renders nothing on its own.
 */
export default function ErrorBoundaryTestPage(): never {
  throw new Error("Boom: intentional crash for e2e/error-boundary.spec.ts (ticket 08)");
}
