import { createRequire } from "node:module";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const { version: reactVersion } = createRequire(import.meta.url)("react/package.json");

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // eslint-config-next sets `react.version: "detect"`, and
    // eslint-plugin-react 7.37.5's detection calls `context.getFilename()`,
    // which ESLint 10 removed — every run crashes before linting a file.
    // An explicit version skips detection entirely; reading it from the
    // installed package keeps it current across React bumps. (Ticket 27.)
    settings: { react: { version: reactVersion } },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
