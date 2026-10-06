## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- When the user types `/graphify`, use the installed graphify skill (`~/.claude/skills/graphify/SKILL.md`) before doing anything else.

## Documentation

Docs live in `docs/` (VitePress + Mermaid), served locally via `npm run docs:dev`.

- When a route, service, or user-facing flow changes, update the matching page under `docs/flows/` (or `docs/architecture/` for structural changes) in the same change — don't let the docs drift from the code they describe.
- Architecture diagrams (`docs/architecture/*`) are kept in sync using this repo's own graphify graph (`graphify query`/`explain`/`path`), consistent with the graphify rules above.
- Flow/sequence diagrams (`docs/flows/*`) are regenerated using a fresh Trailmark call-graph pass (the `trailmark:trailmark` skill), not graphify — Trailmark's branch/exception-type data is what makes the `alt`/`opt` error-path diagrams possible. This is a one-off tool invocation for the pass; it does not persist a second graph in this repo.
- `docs/METHODOLOGY.md` records which tool produced which page and where it fell short (excluded from the built site via `srcExclude` in `docs/.vitepress/config.mts` — it's a maintainer reference, not a docs page). Update the relevant entry there when a page's generation method changes; don't add per-page "how this was generated" prose back into `docs/architecture/*` or `docs/flows/*` themselves.

## Backlog

Tickets live in `backlog/issues/` (see `backlog/specs/` for supporting specs). Each ticket is a `.md` file with a `**Status:**` field and a checklist of completion criteria.

- Never implement a ticket's work directly on `develop`. Before starting, create a feature branch off `develop` named `feat/<ticket-slug>` (e.g. `git checkout -b feat/03-request-correlation-id`, named after the ticket file) and do all commits for that ticket there.
- When a ticket's checklist is fully satisfied, fold these into the same commit that finishes the work on the `feat/` branch (no separate follow-up commit needed, since there's no commit hash to reference):
  - Change the ticket's `**Status:**` line to `done`.
  - Add a `**Completed:**` line referencing the branch that completed the work, e.g. `**Completed:** on \`<branch>\`` — and a `**Pull Request:**` line with the PR URL.
  - Move the file from `backlog/issues/` to `backlog/archive/` (`git mv`, same filename).
  - Push the branch and open a pull request against `develop` (`gh pr create`), updating the PR if needed so it reflects the archived, `done` ticket.
- A ticket's Definition of Done always includes that PR being merged into `develop`, in addition to whatever completion criteria the ticket itself lists — an open-but-unmerged PR is not enough.
- Every PR needs the maintainer's approving review before it can merge (the `develop` ruleset requires one approval, of the latest push). So once the PR is ready and CI's checks pass, stop and ask the maintainer to review it; don't try `gh pr merge` before they've approved, and never use `--admin` (or any other bypass) to skip the review. After they approve, merge: `gh pr merge --squash --delete-branch` (squash is the only merge method `develop` allows). Pushing to the branch after approval dismisses it, so ask again rather than merging. Then delete the local branch and switch back to `develop`.
- Don't leave a finished ticket sitting in `backlog/issues/` with an unchecked or stale `**Status:**`, and don't consider a ticket done while its `feat/` branch hasn't been merged into `develop`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## End-to-end / browser testing

Real browser coverage lives in `e2e/` (Playwright, `npm run test:e2e`). Vitest (`npm test`) never touches a browser — it's service-layer/pure-function only. When a ticket or task touches UI, write or extend a Playwright spec instead of (not just in addition to) simulating clicks as raw `fetch`/`curl` requests against a live `next dev` server — an HTTP-level check can't catch a component that crashes on actual render/hydration (e.g. a Server Component pulling in a client-only child that's missing `"use client"`), which is exactly the class of bug this convention exists to catch.

- `playwright.config.ts` boots the real app via `next dev` against the same `DATABASE_URL` Vitest's `createTestDb()` pattern uses — no mocked network layer.
- `e2e/global-setup.ts` seeds one throwaway member user and a real DB-backed session (the same mechanism `src/proxy.ts`/`src/services/auth/session.ts` use for a real login), writing it as Playwright `storageState` — there's no way to script the real WebAuthn ceremony, so this is the sanctioned way to get a logged-in page for e2e specs. `global-teardown.ts` deletes that user afterward (cascades to its session/items).
- Keep specs here **minimal and smoke-level** — full behavioral coverage (permissions, validation edge cases, service-layer correctness) belongs in Vitest, which is much faster. Reach for Playwright specifically to prove a page/flow actually renders and hydrates end-to-end.
