import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

// A dedicated port (not the one a developer's own `next dev` would use) so
// running `npm run test:e2e` locally never collides with a dev server
// someone already has open. `reuseExistingServer` still lets you point this
// at an already-running server on this port if you prefer.
const PORT = process.env.PLAYWRIGHT_PORT ?? "3100";
// Ticket 29: set PLAYWRIGHT_BASE_URL to run the suite against an
// already-running app (e.g. the production container image) instead of
// booting `next dev`; global setup still seeds through DATABASE_URL.
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  // Ticket 26: specs and global setup/teardown seed data by importing server modules
  // (db client, services) straight into this Node process. Those modules
  // `import "server-only"`, which throws unless resolved with the
  // `react-server` condition Next's own server bundles use — this tsconfig
  // maps it to the package's no-op for the test runner only (Next never
  // reads it), the same move vitest.config.ts makes with an alias. Its
  // `paths` repeats `@/*` because `paths` replaces, not merges, the base's.
  tsconfig: "./tsconfig.playwright.json",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  // Boots the real app (same DB this repo's Vitest suite already talks to
  // via DATABASE_URL) rather than mocking anything — these are smoke tests
  // for the actual rendered app, not a component harness.
  webServer: externalBaseURL
    ? undefined
    : {
        command: `npm run dev -- -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Written by global-setup.ts: a real DB-backed session cookie, the
        // same auth mechanism the app itself uses (see src/proxy.ts) —
        // no WebAuthn ceremony automation needed for a logged-in smoke test.
        storageState: "e2e/.auth/user.json",
      },
    },
  ],
});
