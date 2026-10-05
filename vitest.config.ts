import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Ticket 42: db/ holds the DB image's sources, tested here too.
    include: ["src/**/*.test.ts", "db/**/*.test.ts"],
    setupFiles: ["dotenv/config"],
    coverage: {
      provider: "v8",
      include: ["src/**", "db/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Ticket 26: `server-only` throws unless resolved with the `react-server`
      // condition, which Next's server bundles set and Vitest doesn't. Tests
      // run server-side code in Node, so point it at the package's own no-op.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
});
