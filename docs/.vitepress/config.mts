import { withMermaid } from "vitepress-plugin-mermaid";

// withMermaid wraps VitePress's own defineConfig: it registers the Mermaid
// markdown-it plugin and client-side renderer so ```mermaid fenced blocks
// in these docs render as diagrams, both in `docs:dev` and in the static
// `docs:build` output.
export default withMermaid({
  title: "Pensieve Docs",
  description: "Architecture and flow documentation for the Pensieve app",

  // METHODOLOGY.md is a maintainer reference for how these pages were
  // generated/regenerated, not a docs page — keep it out of the built site
  // entirely rather than just out of the nav.
  srcExclude: ["METHODOLOGY.md"],

  // vitepress-plugin-mermaid pre-registers optimizeDeps.include for
  // mermaid's own transitive deps (dayjs, debug, cytoscape, ...), but its
  // hardcoded list predates mermaid adding a `fastdom` dependency (used for
  // DOM-measurement in `mermaid/dist/chunks/mermaid.core/*.mjs`). Without
  // this, `fastdom/extensions/fastdom-promised.js` — a raw CJS/UMD file —
  // gets served unbundled in dev mode and fails to load as an ES module
  // ("doesn't provide an export named: 'default'") on any page with a
  // mermaid diagram. withMermaid() spreads its own list onto whatever's
  // already here, so this survives that merge.
  vite: {
    optimizeDeps: {
      include: ["fastdom", "fastdom/extensions/fastdom-promised.js"],
    },
  },

  themeConfig: {
    nav: [
      { text: "Architecture", link: "/architecture/project-walkthrough" },
      { text: "Flows", link: "/flows/login-with-passkey" },
    ],

    sidebar: [
      {
        text: "Architecture",
        items: [
          { text: "Project Walkthrough", link: "/architecture/project-walkthrough" },
          { text: "System Overview", link: "/architecture/system-overview" },
          { text: "Database Schema", link: "/architecture/database-schema" },
          { text: "Module Structure", link: "/architecture/module-structure" },
          { text: "Error Handling & Logging", link: "/architecture/error-handling-logging" },
        ],
      },
      {
        text: "Flows",
        items: [
          { text: "Login with Passkey", link: "/flows/login-with-passkey" },
          { text: "Register with Invite", link: "/flows/register-with-invite" },
          { text: "Account Recovery", link: "/flows/account-recovery" },
          { text: "Admin: Manage Invites", link: "/flows/admin-manage-invites" },
          { text: "Item Lifecycle", link: "/flows/item-lifecycle" },
          { text: "Items Import/Export", link: "/flows/items-import-export" },
          { text: "Flashcard Lifecycle", link: "/flows/flashcard-lifecycle" },
          { text: "Flashcards Import/Export", link: "/flows/flashcards-import-export" },
          { text: "Flashcard Study Session", link: "/flows/flashcard-study-session" },
          { text: "Wiki Article Management", link: "/flows/wiki-article-management" },
        ],
      },
    ],

    socialLinks: [],
  },

  mermaid: {
    // Keep default theme; VitePress's own dark-mode class toggling is
    // enough for the diagrams these docs use (flowchart/sequenceDiagram/
    // erDiagram).
  },
});
