# 10: Continuous integration pipeline and deployable container image

## Problem Statement

Nothing checks a change before it lands. The repository has no CI at all: no linting, type-checking or test run happens anywhere but on the maintainer's laptop, no secret scanning, no static analysis, no dependency-vulnerability analysis, and no artifact that could actually be deployed. Several problems are already sitting undetected on `develop` because of this:

- **The production build is broken.** `next build` fails with a Turbopack internal error (`node:async_hooks` cannot be bundled for the browser) because a client component on the flashcards page imports a runtime helper from a server-side service module, which transitively pulls in the LogTape logging/mutation-log stack. `next dev` compiles routes lazily and tolerates this, so the Playwright suite, which boots `next dev`, never noticed. This is exactly the class of bug the project's e2e convention exists to catch, and it slipped through because nothing ever runs the production build.
- **The linter cannot run.** ESLint crashes on startup because `typescript-eslint` (latest 8.71.0) supports `typescript >=4.8.4 <6.1.0`, and the repo is on TypeScript 7.0.2.
- **There is no deployable artifact.** The Next config has no standalone output, there is no Dockerfile, and nothing in the repo can produce something a container platform could run.

The repository has just been made public (see Further Notes), which raises the stakes: anyone can now open a pull request, workflow logs and artifacts are publicly readable, and a leaked secret or a vulnerable dependency is visible to everyone. The maintainer wants every change gated by lint, types, tests, secret scanning, SAST and SCA; a Software Bill of Materials produced for every build; and a hardened, scanned, deployable container image as the pipeline's output.

## Solution

A single GitHub Actions workflow runs on every pull request into `develop` or `main` and on every push to those branches. Independent gate jobs run in parallel: lint (ESLint, actionlint for workflows, hadolint for the Dockerfile), type-check, unit tests against a real Postgres, secret scanning (TruffleHog), SAST and SCA (Semgrep), SBOM generation (CycloneDX via `npm sbom`), and a docs-site build. Alongside them, the pipeline builds an arm64 container image from Next's standalone output on a minimal distroless Node base; before the image leaves the build job it is scanned for embedded secrets (Trivy), so a leaking image is never published as an artifact; it is then scanned for vulnerabilities (Trivy) and exercised end-to-end by Playwright running against the *built image itself*, not `next dev`. The branch rulesets require each gate job by name. (Revised after spec 13, then reverted: path-conditional jobs behind an aggregate `gate` were built in ticket 38 and rejected. Every job runs on every change, and the rulesets require each job by name.)

Results surface in GitHub Code Scanning (SARIF from Semgrep, Trivy and TruffleHog) and in each run's summary. CodeQL default setup runs alongside as an extra, non-blocking signal, notably for GitHub Actions workflow security. On a push to `develop` the image is kept as a downloadable deployable artifact; publishing to a registry on `main` is specified separately (spec 12).

Before any of that can pass, two pre-existing breakages are fixed: the client/server import boundary that breaks `next build` (with a guard so it can't silently recur), and the TypeScript version that breaks ESLint. A local pre-commit hook adds a cheap first line of defence against committing secrets.

## User Stories

1. As the maintainer, I want every pull request to run lint, type-check and unit tests automatically, so that I don't have to remember to run them locally before merging.
2. As the maintainer, I want a merge into `develop` or `main` to be blocked unless every CI gate has passed, so that a red build can never land by accident.
3. As the maintainer, I want the branch rulesets to require each gate job by name, so that every gate visibly blocks a merge and the pipeline needs no extra aggregate job. (Revised during ticket 30: an aggregate `ci-ok` job was built and then dropped. Its `needs` list had to name every gate anyway, and the pipeline changes rarely once complete, so keeping the job list in the rulesets costs little.) (Revised after spec 13, then reverted: path-conditional jobs behind an aggregate `gate` were built in ticket 38 and rejected as over-engineered. Required status checks already block unless each job succeeds, is neutral or is skipped, and every scanner fails its job on findings. So every job runs on every change and the rulesets keep requiring each job by name. A new job, including the `db.yml` jobs (spec 13) and `iac` (spec 11), is added to both rulesets when it lands.)
4. As the maintainer, I want pull requests into `main` to fail unless they come from `develop`, so that `main` only ever receives release PRs.
5. As the maintainer, I want the production build to succeed again, so that a deployable artifact can exist at all.
6. As a developer, I want importing a server-only module (logging, mutation log, database) from a client component to fail the build with a clear message, so that the async_hooks breakage can't recur as an opaque Turbopack internal error.
7. As a developer, I want the flashcard delete-permission check to live in a pure, client-safe module, so that client components can use it without dragging server code into the browser bundle.
8. As a developer, I want ESLint to actually run, so that the lint gate is meaningful.
9. As a developer, I want the TypeScript version pinned to one the linter supports, and Dependabot told not to propose the unsupported major, so that the lint gate doesn't silently break again on an automated upgrade.
10. As a developer, I want the Node and npm versions pinned and declared, so that CI and local installs resolve dependencies identically and honour the repo's install-script allowlist.
11. As the maintainer, I want GitHub workflows linted, so that mistakes in the pipeline itself are caught before they run.
12. As the maintainer, I want the Dockerfile linted, so that common image-hardening mistakes are caught at review time.
13. As the maintainer, I want every PR's new commits scanned for secrets, so that a credential is caught before it's merged into a public repository.
14. As the maintainer, I want every push to `develop`/`main` to scan the pushed commits for secrets, so that anything that slipped past PR scanning is still found. (Revised during ticket 31: originally the full history. Rescanning old commits meant keeping a custom fingerprint allowlist for findings already in history, since TruffleHog can't ignore those natively. History was scanned clean at publication and GitHub secret scanning covers it continuously, so pushes scan only `before..after`.)
15. As the maintainer, I want the secret scan to fail on unverified as well as verified findings, so that a credential that merely couldn't be verified (e.g. an internal one) still blocks.
16. As the maintainer, I want a local pre-commit hook that scans staged changes for secrets, so that most leaks never reach GitHub at all, where they would have to be rotated anyway.
17. As the maintainer, I want SAST on every change, so that injection, auth and unsafe-API bugs are flagged before merge.
18. As the maintainer, I want SCA on every change, so that a newly introduced vulnerable dependency is flagged before merge.
19. As the maintainer, I want SAST/SCA blocking thresholds managed in one place (the Semgrep dashboard policies), so that I can tune what blocks without editing the workflow.
20. As the maintainer, I want SAST to still run on fork pull requests, where repository secrets aren't available, so that outside contributions aren't scanned less thoroughly than my own.
21. As the maintainer, I want an SBOM in CycloneDX format generated for every build, so that I have a record of exactly which production dependencies shipped.
22. As the maintainer, I want the SBOM to cover production dependencies only, so that it describes what is actually in the image.
23. As the maintainer, I want a container image built from Next's standalone output, so that the deployable artifact contains only what the server needs at runtime.
24. As the maintainer, I want that image based on distroless Node (no shell, no package manager) and running as a non-root user, so that its attack surface is minimal.
25. As the maintainer, I want the base image pinned by digest and kept current by Dependabot, so that builds are reproducible yet still pick up base-image security fixes.
26. As the maintainer, I want the image built natively for arm64, so that it matches the Graviton runtime it will be deployed to without slow emulation.
27. As the maintainer, I want the built image scanned for known vulnerabilities, so that OS-level and runtime CVEs are caught, not just npm ones.
28. As the maintainer, I want the image scan to fail on any severity only when a fix is available, so that I'm blocked on things I can act on and not on unfixable upstream CVEs.
29. As the maintainer, I want an exceptions file for image-scan findings with a recorded reason and expiry, so that a deliberate, reviewed exception doesn't block forever and doesn't become permanent by accident.
30. As the maintainer, I want the image to include a health endpoint and an in-image health check, so that both the container runtime and the e2e job can tell when the app is genuinely ready.
31. As an operator, I want the health endpoint to confirm database connectivity, not just process liveness, so that a broken DB connection shows up as unhealthy.
32. As an operator, I want the health endpoint reachable without a session but revealing nothing beyond up/down, so that it's the smallest possible exception to "everything behind auth."
33. As an operator, I want the image to be able to apply database migrations itself via a dedicated entrypoint, so that the deployable artifact is self-sufficient and migration code always matches app code. (Revised after spec 13: the migrator and the migration SQL move to a dedicated DB image, so the app image can no longer change the schema.)
34. As the maintainer, I want the Playwright suite to run against the built image, so that standalone-output, Dockerfile, migration-entrypoint and hydration breakages are caught in CI rather than in production. (Revised after spec 13: e2e migrates its database with drizzle-kit from source. The DB image's migrator is tested in the DB workflow.)
35. As the maintainer, I want e2e to run against a fresh, disposable Postgres per run, so that tests never depend on leftover state.
36. As the maintainer, I want unit tests to run against a real Postgres service container, so that the existing service-layer tests keep exercising real SQL.
37. As the maintainer, I want the VitePress docs site built in CI, so that a dependency bump (e.g. mermaid) that breaks the docs is caught.
38. As the maintainer, I want all scanner findings in GitHub Code Scanning, so that they appear in the Security tab and as annotations on the PR diff.
39. As the maintainer, I want a readable summary of each gate in the workflow run page, so that I don't have to dig through logs to see why something failed.
40. As the maintainer, I want CodeQL to analyse both the TypeScript code and the GitHub Actions workflows, so that workflow-injection and risky-trigger issues are surfaced now that the repo is public.
41. As the maintainer, I want CodeQL findings to be informational rather than blocking, so that Semgrep remains the single SAST gate.
42. As the maintainer, I want pushes to `develop` to retain the built image as a downloadable artifact, so that a known-good, fully-gated image exists for every integrated change.
43. As the maintainer, I want superseded runs on the same PR cancelled, so that CI time isn't wasted on commits that have already been replaced.
44. As the maintainer, I want runs on `develop` and `main` never cancelled, so that every integrated commit gets a complete result.
45. As the maintainer, I want npm, Docker layers and the vulnerability database cached, so that CI stays fast.
46. As the maintainer, I want every job to have a timeout, so that a hung job can't burn minutes indefinitely.
47. As the maintainer, I want short retention for internal hand-off artifacts and longer retention for deployable images and SBOMs, so that storage reflects how long each artifact is actually useful.
48. As the maintainer, I want every third-party action pinned to a full commit SHA, so that a compromised action tag can't inject code into my pipeline.
49. As the maintainer, I want every workflow to default to a read-only token and request extra permissions per job, so that a compromised step has the least possible reach.
50. As the maintainer, I want workflows triggered only by `pull_request` (never `pull_request_target`), so that fork code never runs with my secrets.
51. As the maintainer, I want Dependabot to keep GitHub Actions SHAs, the base-image digest and (later) Terraform providers up to date, grouped and weekly, so that pinning doesn't mean falling behind.
52. As the maintainer, I want the four Dependabot PRs opened before CI existed to be validated by CI before merging, so that even trivial bumps go through the gates.
53. As the maintainer, I want local secret files (`.env*`, keys) excluded from the Docker build context, so that a local `docker build` can't bake my credentials into the image, given that Next's standalone output copies `.env` and `.env.production` into the server bundle.
54. As the maintainer, I want every built image scanned for embedded secrets, covering both file contents in every layer and the image config (ENV, labels, build-arg history), so that a credential baked into the image is caught regardless of how it got there.
55. As the maintainer, I want that secret scan to run before the image is uploaded as an artifact, so that a leaking image is never downloadable from this public repository, not even for the 1-day hand-off window.
56. As the maintainer, I want image secret findings in GitHub Code Scanning, so that they're visible even when the build fails because of them.
57. As the maintainer, I want image secret-scan exceptions recorded per tool with a reason and expiry, so that a false positive in a dependency doesn't block every build forever and an exception doesn't become permanent by accident.

## Implementation Decisions

**Prerequisite fixes (land first, as their own change):**
- The flashcard delete-permission predicate moves out of the flashcards service into a new pure, I/O-free flashcards permissions module, following the established pattern of the flashcards pagination and tag-validation modules that client components already import safely. The service module re-exports it so server-side callers are unaffected.
- The logging module, the mutation-log module and the database client module each import the `server-only` marker package, so any future client-side import fails the build with an explicit error.
- After the fix, verify whether `next build` needs a reachable database. If any route queries the database during static generation, mark it dynamic rather than giving the image build database access.
- TypeScript is pinned to 6.0.3 (the last JS-based release, within typescript-eslint's supported range). Dependabot ignores TypeScript ≥ 7 until typescript-eslint supports it.

**Toolchain:**
- `.nvmrc` pins Node 24 for `setup-node`; `package.json` gains an `engines` field. CI installs an exact npm version (11.16.0, which honours the `allowScripts` allowlist) before `npm ci`.
- The existing Dependabot config (npm, daily) gains the `github-actions`, `docker` and `terraform` ecosystems, all weekly with grouped minor/patch updates.
- A `lefthook` config runs TruffleHog over staged changes as a pre-commit hook. Both tools are installed via Homebrew and the one-time `lefthook install` is documented in the README. There's no npm `prepare` script, so nothing runs inside `npm ci` or the image build.

**Container image:**
- Next's `output: "standalone"` is enabled.
- **Build context:** a denylist `.dockerignore` excludes at least `.env*`, `*.pem`, `.git`, `node_modules`, `.next`, `coverage`, `logs`, `e2e/.auth`, `test-results`, `playwright-report` and `graphify-out`. `.env*` is the critical entry: `next build` copies `.env` and `.env.production` into `.next/standalone` (see `writeStandaloneDirectory` in Next's build), so a developer's local `.env` would otherwise ship inside the image. CI checkouts never contain `.env` (it's gitignored), but a local `docker build .` would.
- Multi-stage Dockerfile: a full Node builder stage runs `npm ci` and `next build`. The runtime stage is `gcr.io/distroless/nodejs24-debian13:nonroot`, pinned by digest, and copies only the standalone server, static assets, public assets, the Drizzle migration SQL and the migration entrypoint. (Revised after spec 13: the migration SQL and entrypoint are removed. The image keeps only `drizzle/meta/_journal.json`, which lists migration tags only, for spec 13's startup check.)
- Built for `linux/arm64` only, on GitHub's native arm64 runners (free now that the repo is public).
- No `sharp`: `next/image` isn't used for rendering.
- **Health endpoint:** a new unauthenticated `GET` route performs a trivial `SELECT 1`. It returns 200 when the database answers and a safe 503 otherwise, with no internal detail. The auth gate in the request proxy exempts exactly this route. The image's `HEALTHCHECK` is a small Node script calling it, since distroless has no `curl`.
- **Migration entrypoint:** a small Node program using drizzle-orm's built-in migrator (not drizzle-kit) and the bundled migration SQL, connecting via `DATABASE_URL`. It exits 0 on success and non-zero on failure. IAM-auth mode is added in spec 11. (Revised after spec 13: it moves to the DB image under `db/`, and the app's `build:ops` keeps only the healthcheck.)

**Workflow structure (a single workflow):**
- Triggers: `pull_request` targeting `develop`/`main`; `push` to `develop`/`main`. No scheduled run. (A weekly scan of unchanged code was planned after spec 13 and dropped: it only adds SCA, which Dependabot covers.)
- **No path-conditional jobs.** Every job runs on every pull request and push. (Added after spec 13 as a `changes` job driving per-job `if:` conditions, built in ticket 38, then rejected.) The DB jobs in `db.yml` (spec 13) and the `iac` job (spec 11) follow the same rule. Never filter a workflow with `on: paths:`: a required check whose workflow didn't trigger never reports, and the PR blocks on it.
- **Scanners must exit non-zero on findings**, so that their required checks block a merge: TruffleHog `--fail`, Trivy `--exit-code 1`, and Semgrep `--error` or the dashboard's blocking policies under `semgrep ci`.
- Default `permissions: contents: read`, with per-job additions (e.g. `security-events: write` for SARIF upload). All actions are pinned by full SHA with a version comment.
- **Parallel gate jobs:** (Revised during ticket 32: a job that runs a single scanner is named after the tool, so `sast-sca`, `secrets` and `image-scan` became `semgrep`, `trufflehog` and `trivy`.)
  - **lint:** ESLint, actionlint and hadolint.
  - **typecheck:** `tsc --noEmit`.
  - **unit:** Vitest with a `postgres:17-alpine` service container, migrated with drizzle-kit before tests.
  - **trufflehog:** TruffleHog over the PR's commit range on `pull_request`, and the pushed `before..after` range on `push`. Fails on verified, unknown and unverified results. False positives get an inline `trufflehog:ignore` comment on the offending line; there's no separate allowlist.
  - **semgrep:** `semgrep ci` authenticated with the `SEMGREP_APP_TOKEN` secret, so blocking is decided by the Semgrep dashboard policies for Code and Supply Chain. When the token is unavailable (fork PRs), it falls back to `semgrep scan` with `p/default`, `p/typescript`, `p/react`, `p/nextjs` and `p/owasp-top-ten`. Both emit SARIF. (A split into `semgrep-sast` and `semgrep-sca`, planned after spec 13 so each could run on its own paths, was dropped with path-conditional jobs.) (Revised during ticket 32: the fallback blocks on any finding. Its rulesets flagged the repo's missing npm release-age and Dependabot cooldown, so `.npmrc` sets `min-release-age=7` and Dependabot a matching 7-day cooldown.)
  - **sbom:** `npm sbom --sbom-format cyclonedx --omit dev`, uploaded as an artifact.
  - **docs-build:** `npm run docs:build`.
  - **build:** buildx on an arm64 runner with the GitHub Actions layer cache. (Revised during ticket 33: the repository allows only GitHub-owned actions, so buildx runs from the runner's CLI with a `type=local` cache persisted by `actions/cache`.) Before the image is uploaded, it's scanned for embedded secrets by Trivy with `--scanners secret` and `--image-config-scanners secret`, covering every layer's file contents plus ENV, labels and build-arg values in the layer history. A custom rule in `trivy-secret.yaml` adds URLs with embedded credentials (e.g. `DATABASE_URL`), which Trivy's built-in rules miss. (Revised during ticket 33: TruffleHog's `docker` source was dropped as a second image scanner. Its only false positive, the distroless base's dpkg `*.md5sums` lists, needed a custom expiring exclude file, and the custom Trivy rule covers the connection strings it had uniquely caught.)

    Any finding fails the job before `upload-artifact`, so a leaking image is never published. Only a clean image is uploaded as a `docker save` tarball artifact. Trivy's SARIF goes to Code Scanning from this job, which gets `security-events: write` (uploaded with `if: always()`, so findings survive the failure they cause).
    - Exceptions: Trivy secret false positives go in the `trivy-secret.yaml` allow rules. Each entry carries a reason and an expiry, the same discipline as `.trivyignore`.
- **After the build:**
  - **trivy:** Trivy vulnerability scan (secrets are already covered in `build`) on the built image, failing on any severity with `--ignore-unfixed`. Exceptions live in `.trivyignore`, each with a reason and expiry. The vulnerability DB comes from the `public.ecr.aws` mirror and is cached daily. (Revised during ticket 34: Trivy covers the Debian packages and the bundled npm packages but can't detect the distroless Node binary, which isn't a dpkg package. Node runtime CVEs are covered by Dependabot's base-image digest bumps instead. `.trivyignore` expiries use Trivy's own `exp:` syntax, so they're enforced rather than reviewed by hand.)
  - **e2e:** runs inside the official Playwright v1.63.0 container on an arm64 runner. It loads the image, starts a Postgres service container, runs the image's migration entrypoint against it as the superuser (revised after spec 13: `npm run db:migrate`, drizzle-kit from source, since the app image no longer has a migrator), starts the app container, waits on the health endpoint, then runs Playwright. `PLAYWRIGHT_BASE_URL` disables the config's `webServer` block. The existing global setup seeds its session user directly through `DATABASE_URL` as today. (Revised during ticket 35: the job runs on the arm64 runner host and starts the Playwright image with `docker run`, rather than using it as the job container. A job container has no Docker CLI to load and start the app. Every container shares the host network so the browser reaches the app at `localhost`, because Chrome accepts the production `Secure` session cookie over plain HTTP only there.)
- **Aggregate checks:**
  - **No aggregate job.** The rulesets require every gate by its job name, plus "branches up to date". Adding or renaming a gate means updating both rulesets in the same change. A required check that is skipped counts as passing. That's safe for jobs skipped because a job they need failed, since that needed job is itself required and blocks. A job must not be made conditional on anything else (e.g. a paths filter), or its required check would never report on PRs it skips. (Revised after spec 13 to path-conditional jobs behind an aggregate `gate`, built in ticket 38, then reverted: this paragraph stands as written. Jobs are never path-conditional, so every required check reports on every PR.)
  - **`release-source`** runs only on PRs into `main` and fails unless the head branch is `develop`. The `main` ruleset requires it.
- SARIF from Semgrep, Trivy (vulnerabilities and image secrets) and TruffleHog (repository) is uploaded to Code Scanning, and each gate writes a short `$GITHUB_STEP_SUMMARY`.
- **Concurrency:** grouped by workflow and ref, with `cancel-in-progress` only for `pull_request` events.
- **Timeouts:** every job sets `timeout-minutes` (about 10 for most, about 20 for build and e2e).
- **Artifact retention:** 1 day for the build→e2e/scan hand-off, 14 days for the image from `develop` pushes (the deployable artifact), 90 days for SBOMs.
- **CodeQL:** default setup, a repository setting enabled by the maintainer after the workflow lands, for `javascript-typescript` and `actions`. Its findings don't block.

**Rulesets (after the workflow lands):** the existing `develop`/`main` rulesets gain required status checks (every gate job by name; plus `release-source` on `main`) with strict up-to-date enforcement. (Revised during ticket 38's reversal: `main` also requires `sbom`, matching `develop`. Jobs added later, such as `iac` and the `db.yml` jobs, are added to both rulesets by name.) They already require signed commits and PRs, forbid force-pushes and deletion, and allow no bypass. Merge methods: squash only on `develop`, merge commits only on `main`.

**Dependabot backlog:** PRs #1–#4 wait for this workflow. The patch bumps merge once green; the mermaid 11→12 major merges only if `docs-build` passes and the diagrams look right locally.

## Testing Decisions

- **Good tests here verify external behaviour of the shipped artifact and its endpoints, not pipeline internals.** The workflow, Dockerfile and lint configuration aren't unit-tested: actionlint and hadolint check them statically, and real CI runs prove them.
- **Primary seam: Playwright against the built production image.** This is the highest seam and the one that catches the classes of bug this spec exists for: a broken standalone build, a Dockerfile missing files, a migration entrypoint that can't migrate (revised after spec 13: now tested in the DB workflow), and Server/Client Component hydration failures. The existing e2e specs and global setup/teardown are prior art and change only in where they point. Specs stay smoke-level per the project convention.
- **Health endpoint:** tested in Vitest by calling the route handler directly, following the existing route tests under the API routes. Cases: 200 when the DB answers; a safe 503 with no internal detail when it doesn't; and reachable without a session (asserted against the proxy's exemption logic).
- **Flashcard permissions module:** the existing tests for the delete-permission predicate move with it unchanged. The predicate is a pure function, so they stay plain unit tests.
- **Build-boundary regression:** covered by CI's build job itself. With `server-only` in place, a reintroduced client import fails `next build` deterministically. No separate test is needed.
- Unit tests keep using the existing `createTestDb` harness against the CI Postgres service, unchanged.

## Out of Scope

- Publishing the image to a registry, signing it, or attaching the SBOM to it. Covered in spec 12. When spec 12 adds buildx provenance attestations, it should use `mode=min`: `mode=max` records build args in the published attestation.
- The Terraform `iac` job. It's added together with the `infra/` code in spec 11.
- IAM database authentication (spec 11), and the `db-bootstrap` task, least-privilege database roles and the DB image (spec 13). e2e deliberately runs migrations and the app as the Postgres superuser.
- Continuous deployment. (Revised after spec 13: manually dispatched deploy workflows are added by specs 12 and 13.)
- Multi-arch (amd64) images.
- A scheduled/nightly pipeline run. (A weekly scan-only run was planned after spec 13, then dropped.)
- Publishing the docs site to GitHub Pages; it's only built here.
- A local `npm run check` aggregate script.
- Migrating from ESLint to Oxlint, or moving to TypeScript 7.
- PR comments from scanners; findings go to Code Scanning and run summaries only.

## Further Notes

**Repository context:** this work happens in the new public `sgspinola/pensieve` repository. Before it was published (Phase 0, complete):
- The previous private repository was renamed to `pensieve-archive` and kept private with its full history, PRs and issues. A mirror backup of it is kept locally.
- The public repository starts from a single signed "Initial commit". Personal and generated content was removed before publishing: the flashcards content, one-off scripts, project-level skills and the graphify output, which is now local-only and gitignored. A full-history TruffleHog scan of the published commit was clean. The code is MIT-licensed.
- Repository hardening is already in place:
  - squash and merge commits only, head branches deleted after merging
  - secret scanning with push protection, Dependabot alerts and security updates
  - private vulnerability reporting and a security policy
  - Actions: read-only token by default, approval required for outside contributors, SHA pinning enforced
  - `develop`/`main` rulesets requiring PRs and signed commits, with no bypass
- Local commits are SSH-signed and authored with the GitHub noreply address.

**Maintainer-only steps:**
- add the `SEMGREP_APP_TOKEN` repository secret
- configure the blocking policies for Code and Supply Chain in the Semgrep dashboard
- after the workflow lands, enable CodeQL default setup and add the required checks to both rulesets

**If a secret is found in an image or anywhere else in CI:**
- Rotate the credential. Removing it from the image or history isn't enough, because the repo is public.
- Delete any Actions artifacts and caches that may contain it (`gh run delete` / artifact deletion, `gh cache delete`).
- Treat the affected run logs as exposed.

**Why this order:** the build-boundary fix and the TypeScript pin come first because the build, e2e and lint gates can't pass without them. The container image comes before the workflow so it can be built and run locally first.

This spec was produced by a multi-round `grill-me` session. Facts were checked against the environment rather than assumed:
- the ESLint/TypeScript incompatibility, via npm registry peer-dependency data
- the build failure and its import chain, from a real `next build` run
- the availability of the distroless base image's tags, via the registry API
- the repo's branch-protection and Code Scanning eligibility, via the GitHub API
- the npm version's support for `allowScripts`
