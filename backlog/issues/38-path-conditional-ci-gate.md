# 38: Path-conditional CI jobs behind a single `gate` check

**What to build:** A change only pays for the CI jobs whose inputs it touched, and the rulesets stop listing jobs by name. A first `changes` job (a plain `git diff --name-only` shell step, since only GitHub-owned actions are allowed) diffs against the PR base or the push's `before` commit and exposes one boolean per area. Every other job gets an `if:` on those outputs, per spec 10's path matrix. `semgrep` splits into `semgrep-sast` (Code rules) and `semgrep-sca` (Supply Chain), so each can run on its own paths. A new `gate` job is the only check the rulesets require. Spec: `backlog/specs/10-ci-pipeline.md` (user story 3 revision; "Path-conditional jobs" and "Aggregate checks" under Implementation Decisions).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `changes` job computes changed paths against the PR base (`pull_request`) or `before` (`push`) and exposes one output per area
- [ ] Each job's `if:` matches spec 10's matrix: trufflehog always; lint, typecheck, semgrep-sast, semgrep-sca, sbom, unit, docs-build, and build/trivy/e2e on their listed paths
- [ ] Any change under `.github/workflows/` or `.github/actions/` runs every job; a push to `main` runs every job regardless of paths; paths outside the matrix (README, `backlog/`) run only `trufflehog`
- [ ] `semgrep` is split into `semgrep-sast` (Code only) and `semgrep-sca` (Supply Chain only). Both keep the token / fork-fallback behaviour, SARIF upload and blocking semantics
- [ ] `gate` job: `if: always()`, `needs` every other job, and fails when any needed job's result is `failure` or `cancelled`. `skipped` counts as passing
- [ ] Verified by real runs: a docs-only PR skips the app jobs and `gate` passes; a `src/` PR runs them; a deliberately failing job makes `gate` fail
- [ ] The `develop` and `main` rulesets require `ci / gate` (plus `release-source` on `main`) instead of every job by name, keeping strict up-to-date enforcement
- [ ] The workflow's header comment and the spec 10 revision notes reflect "add a job to `gate`'s `needs`, not to the rulesets"
