# 38: Path-conditional CI jobs behind a single `gate` check

**What to build:** A change only pays for the CI jobs whose inputs it touched, and the rulesets stop listing jobs by name. A first `changes` job (a plain `git diff --name-only` shell step, since only GitHub-owned actions are allowed) diffs against the PR base or the push's `before` commit and exposes one boolean per area. Every other job gets an `if:` on those outputs, per spec 10's path matrix. `semgrep` splits into `semgrep-sast` (Code rules) and `semgrep-sca` (Supply Chain), so each can run on its own paths. A new `gate` job is the only check the rulesets require. Spec: `backlog/specs/10-ci-pipeline.md` (user story 3 revision; "Path-conditional jobs" and "Aggregate checks" under Implementation Decisions).

**Blocked by:** None (can start immediately)

**Status:** wontfix

**Pull Request:** https://github.com/sgspinola/pensieve/pull/28 (closed unmerged)

**Why not:** implemented and verified on `feat/38-path-conditional-ci-gate`, then rejected by the maintainer as over-engineered (decision 2026-10-04). The rulesets' required status checks already block a merge unless each required job succeeds, is neutral or is skipped, and every scanner already fails its job on findings (Trivy `--exit-code 1`, TruffleHog `--fail`, Semgrep `--error` or the dashboard policies). So neither the aggregate `gate` nor the `changes` job earns its keep: every job runs on every PR, the rulesets keep requiring each job by name, and `semgrep` stays one job. Scanners also stay as digest-pinned images rather than third-party actions. Semgrep and actionlint publish no action, TruffleHog's can't be digest-pinned or emit SARIF, and trivy-action downloads a tag-pinned binary; its tags were hijacked in March 2026 (CVE-2026-33634). The checklist below records what was built and verified before the decision; none of it landed.

- [x] `changes` job computes changed paths against the PR base (`pull_request`) or `before` (`push`) and exposes one output per area
- [x] Each job's `if:` matches spec 10's matrix: trufflehog always; lint, typecheck, semgrep-sast, semgrep-sca, sbom, unit, docs-build, and build/trivy/e2e on their listed paths
- [x] Any change under `.github/workflows/` or `.github/actions/` runs every job; a push to `main` runs every job regardless of paths; paths outside the matrix (README, `backlog/`) run only `trufflehog`
- [x] `semgrep` is split into `semgrep-sast` (Code only) and `semgrep-sca` (Supply Chain only). Both keep the token / fork-fallback behaviour, SARIF upload and blocking semantics
- [x] `gate` job: `if: always()`, `needs` every other job, and fails when any needed job's result is `failure` or `cancelled`. `skipped` counts as passing
- [x] Verified by real runs: a docs-only PR skips the app jobs and `gate` passes; a `src/` PR runs them; a deliberately failing job makes `gate` fail
- [ ] The `develop` and `main` rulesets require `ci / gate` (plus `release-source` on `main`) instead of every job by name, keeping strict up-to-date enforcement
- [x] The workflow's header comment and the spec 10 revision notes reflect "add a job to `gate`'s `needs`, not to the rulesets"

**Verification (real runs):** throwaway draft PRs into a base branch that only added a temporary trigger (closed unmerged afterwards):
- docs-only, [#29](https://github.com/sgspinola/pensieve/pull/29) ([run](https://github.com/sgspinola/pensieve/actions/runs/37212675983)): only `changes`, `trufflehog` and `docs-build` ran; every app job was skipped; `gate` passed.
- `src/`-only, [#30](https://github.com/sgspinola/pensieve/pull/30) ([run](https://github.com/sgspinola/pensieve/actions/runs/37212678460)): lint, typecheck, semgrep-sast, unit, build, trivy and e2e ran; docs-build, sbom and semgrep-sca were skipped; `gate` passed.
- deliberately failing unit test, [#31](https://github.com/sgspinola/pensieve/pull/31) ([run](https://github.com/sgspinola/pensieve/actions/runs/37212678768)): `unit` failed, so `gate` failed ("Failed or cancelled: unit").
- PR #28 itself changes the workflow, so every job ran and `gate` passed.

Those runs predate the review follow-up, which widened lint/typecheck/unit/build paths to every real input (any TS/JS file, `tsconfig*`, `drizzle.config.ts`) and renamed the `image` output to `build`. That follow-up was dry-run locally against synthetic changes and gets its own CI run on #28.
