# 55: Docs: CI pipeline architecture page

**What to build:** Readers of the docs site can see what protects each change and what gets published from where. A new architecture page covers both workflows (`ci.yml` and `db.yml`): their jobs (`ci.yml`'s run on every change and are required by name; `db.yml`'s run only when database sources change and aren't required), where findings go, and the `publish`/`publish-db` jobs. It's kept in sync per the repo's docs conventions, and the methodology notes record how it was produced and where graphify didn't reach. Spec: `backlog/specs/12-release-and-operations.md` (user stories 28, 30; "Documentation").

**Blocked by:** 45 (complete `db.yml`), 51 (publish jobs), 63 (CI workflow modularization, so the page describes the final layout). (63 is done.)

**Status:** done

**Completed:** on `feat/55-56-ci-and-aws-docs`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/95

- [x] New page under `docs/architecture/` describing both workflows, their jobs and the per-job required checks, with a Mermaid diagram. `docs/architecture/ci-pipeline.md`: both workflows, every job, the reusable-workflow check names, and which checks the rulesets require (only `protect-main` requires any), with a flowchart
- [x] Covers Code Scanning/run-summary outputs, and `publish`/`publish-db`. "Where results go" (run summaries, SARIF categories, artifacts) and "Publishing"
- [x] Added to the VitePress sidebar; `docs-build` passes. Under Architecture, next to Deployable Image. `npm run docs:build` passes, and the page's Mermaid diagram parses with Mermaid's own parser
- [x] `docs/METHODOLOGY.md` entry added (graphify where it applies, direct reading of workflow sources otherwise), with no "how this was generated" prose in the page itself. "CI pipeline": graphify doesn't index workflow YAML, so the page comes from the workflow sources and the live rulesets
