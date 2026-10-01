import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["dotenv/config"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
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
