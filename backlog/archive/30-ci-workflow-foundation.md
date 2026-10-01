# 30: CI workflow foundation (originally "and the `ci-ok` aggregate")

**What to build:** The single GitHub Actions workflow that gates every change. It runs on `pull_request` targeting `develop`/`main` and on `push` to them (never `pull_request_target`, no schedule). This ticket lands the core gates — lint (ESLint + actionlint), typecheck, unit tests against a real Postgres, docs-build — plus the two aggregate checks the rulesets will require: `ci-ok` (needs every gate, runs `if: always()`, fails if any needed job failed or was cancelled) and `release-source` (on PRs into `main` only, fails unless the head branch is `develop`). It also establishes the pipeline's security and hygiene baseline that every later job follows. Spec: `backlog/specs/10-ci-pipeline.md` (user stories 1–4, 11, 36, 37, 39, 43–46, 48–51).

**Blocked by:** 27 (lint and typecheck must pass on the pinned toolchain)

**Status:** done

**Completed:** on `feat/30-ci-workflow-foundation`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/13

- [x] Workflow triggers only on `pull_request` and `push` for `develop`/`main`
- [x] Workflow-level `permissions: contents: read`; any extra permission requested per job
- [x] Every third-party action pinned to a full commit SHA with a version comment
- [x] Node from `.nvmrc` via `setup-node` with npm caching; exact npm 11.16.0 installed before `npm ci`
- [x] **lint** job runs ESLint and actionlint
- [x] **typecheck** job runs `tsc --noEmit` — via `npm run typecheck` (`next typegen && tsc --noEmit`): `PageProps`/`LayoutProps` and `next-env.d.ts` are Next-generated, so a fresh checkout can't typecheck without `next typegen` first
- [x] **unit** job runs Vitest against a `postgres:17-alpine` service container, migrated with drizzle-kit first
- [x] **docs-build** job runs `npm run docs:build`
- [x] ~~**`ci-ok`** aggregates all gate jobs as described and is the only check that will need to be required~~ — built and verified, then **dropped by maintainer decision** before merge: the rulesets require each gate by job name instead (spec 10 story 3 and Implementation Decisions revised; ticket 36 lists the checks)
- [x] **`release-source`** runs only for PRs into `main` and fails unless head is `develop` — and the head repo is this repository, since a fork's branch can also be named `develop`
- [x] Concurrency grouped by workflow + ref, `cancel-in-progress` only for `pull_request` events
- [x] Every job sets `timeout-minutes`
- [x] Each gate writes a short `$GITHUB_STEP_SUMMARY`
- [x] Dependabot config gains the `github-actions` ecosystem, weekly, with grouped minor/patch updates
- [x] actionlint passes on the workflow itself
- [x] The PR for this ticket shows all jobs green, and `ci-ok` fails when a gate is deliberately broken (verified once on a throwaway commit) — draft PR #14 (deliberate type error into `develop`): typecheck and `ci-ok` failed; draft PR #15 (same branch into `main`): `release-source` failed. Both closed, branch deleted
