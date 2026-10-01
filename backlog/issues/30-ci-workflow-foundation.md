# 30: CI workflow foundation and the `ci-ok` aggregate

**What to build:** The single GitHub Actions workflow that gates every change. It runs on `pull_request` targeting `develop`/`main` and on `push` to them (never `pull_request_target`, no schedule). This ticket lands the core gates — lint (ESLint + actionlint), typecheck, unit tests against a real Postgres, docs-build — plus the two aggregate checks the rulesets will require: `ci-ok` (needs every gate, runs `if: always()`, fails if any needed job failed or was cancelled) and `release-source` (on PRs into `main` only, fails unless the head branch is `develop`). It also establishes the pipeline's security and hygiene baseline that every later job follows. Spec: `backlog/specs/10-ci-pipeline.md` (user stories 1–4, 11, 36, 37, 39, 43–46, 48–51).

**Blocked by:** 27 (lint and typecheck must pass on the pinned toolchain)

**Status:** ready-for-agent

- [ ] Workflow triggers only on `pull_request` and `push` for `develop`/`main`
- [ ] Workflow-level `permissions: contents: read`; any extra permission requested per job
- [ ] Every third-party action pinned to a full commit SHA with a version comment
- [ ] Node from `.nvmrc` via `setup-node` with npm caching; exact npm 11.16.0 installed before `npm ci`
- [ ] **lint** job runs ESLint and actionlint
- [ ] **typecheck** job runs `tsc --noEmit`
- [ ] **unit** job runs Vitest against a `postgres:17-alpine` service container, migrated with drizzle-kit first
- [ ] **docs-build** job runs `npm run docs:build`
- [ ] **`ci-ok`** aggregates all gate jobs as described and is the only check that will need to be required
- [ ] **`release-source`** runs only for PRs into `main` and fails unless head is `develop`
- [ ] Concurrency grouped by workflow + ref, `cancel-in-progress` only for `pull_request` events
- [ ] Every job sets `timeout-minutes`
- [ ] Each gate writes a short `$GITHUB_STEP_SUMMARY`
- [ ] Dependabot config gains the `github-actions` ecosystem, weekly, with grouped minor/patch updates
- [ ] actionlint passes on the workflow itself
- [ ] The PR for this ticket shows all jobs green, and `ci-ok` fails when a gate is deliberately broken (verified once on a throwaway commit)
