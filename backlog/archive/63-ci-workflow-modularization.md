# 63: CI workflow modularization

**What to build:** A maintainer can open the CI workflow and read it as a short orchestrator instead of 740 lines. The self-contained areas each live in a file of their own: the infrastructure checks in one reusable workflow, and the image pipeline (build, vulnerability scan, e2e against the built image) in another. Long shell moves out of YAML into CI scripts, and the four SARIF uploads with their finding-count summaries share one composite action. What gates a merge doesn't change. Neither does how a release is published and signed: `publish` stays a top-level job in `ci.yml`, so its keyless signing identity (`ci.yml@refs/heads/main`, which the deploy scripts verify against) stays valid. There's no spec: the decisions come from a design session on the CI workflow, recorded below.

**Blocked by:** None (can start immediately)

**Status:** done

**Completed:** on `feat/63-ci-workflow-modularization`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/84

Decisions:

- Only `iac` and the image pipeline (`build` → `trivy` → `e2e`, with the shared Trivy image) become reusable workflows, called from `ci.yml` by caller jobs named `iac` and `image`. The small jobs (lint, typecheck, unit, docs-build, semgrep, sbom, trufflehog, release-source) stay inline.
- The caller jobs grant the maximum permissions their callees need (`id-token: write` for `iac`, `security-events: write` for `image`). `iac`'s credentials are `plan` Environment secrets, resolved in the called job that declares the Environment. (Revised during the work: the PR's first run planned with both secrets empty, though the Environment's variable resolved. A called job sees only secrets its caller hands down. `secrets: inherit` fixed the plan, but Semgrep's blocking `secrets-inherit` rule rejects it, so `iac`'s caller passes the two by name, and `iac.yml` declares them under `workflow_call`. `image` passes none.) Concurrency stays on `ci.yml` only.
- `publish` is unchanged apart from its `needs`, which becomes the inline gates plus `iac` and `image`.
- Shell that runs over about 15 lines or carries real logic moves to CI-only scripts under `.github/` (the `iac` plan and summary, the `trufflehog` scan, the `trivy` summary). One-line summaries stay inline.
- actionlint only shellchecks inline `run:` blocks, so `lint` gains a digest-pinned shellcheck step over the CI scripts and the existing `scripts/`. Any findings in the deploy and bootstrap scripts are fixed in the same PR.
- YAML anchors replace the repeated checkout step within a file. The postgres service stays duplicated between `unit` and `e2e` (different files after the split), with its "bump together" comment.
- Comments move with their code, unreworded, so the diff stays reviewable. `ci.yml`'s header keeps the rules every gate follows, the ruleset and `needs` rules, and a map of which file holds what.
- Reusable-workflow checks are named `<caller> / <callee>`. `protect-main`'s required checks change from `iac`, `build`, `trivy`, `e2e` to `iac / iac`, `image / build`, `image / trivy`, `image / e2e`, through the GitHub API, with the maintainer's OK, right before the release PR that carries this change. `protect-develop` requires no checks, so develop PRs are unaffected.
- One PR for the whole ticket.

Done when:

- [x] The reusable workflows, CI scripts and SARIF composite action exist, and `ci.yml` calls them as described above. `iac.yml`, `image.yml`, `.github/scripts/` (iac plan and summary, trufflehog, trivy summary) and `.github/actions/upload-sarif`
- [x] The PR's runs pass the same set of jobs with the same step summaries, `iac`'s prod plan included. Run 38369106186: every job passed, the plan step ran with both `plan` secrets masked (the first run, 38363797853, had them empty; see the revised decision above)
- [x] Code Scanning still receives the same SARIF categories (`Semgrep`, `Secrets`, `Container SCA`). Run 38369106186 uploaded `Semgrep`, `Secrets` (Trivy and TruffleHog) and `Container SCA`
- [x] actionlint and the new shellcheck step pass. The existing `scripts/` had no findings, so none needed fixing
- [x] README's CI section, `docs/architecture/deployable-image.md`, and the comments in `db.yml` and the `publish-image` action that refer to `ci.yml`'s jobs are updated. Rulesets now require gates "by check name", not "by job name". The full CI architecture page stays in 55
- [x] `protect-main` requires the new check names, and the release PR carrying this change satisfies it. Switched on 2026-10-13 through the rulesets API (only those four contexts changed); release PR #85 passed every required check under the new names
- [x] After that release, `publish` runs and `cosign verify` against `ci.yml@refs/heads/main` passes on the new image, or nothing is pushed because the app didn't change. Release `600590b` (#85, CI run 38376593097): `publish` succeeded and pushed nothing, since the app image's config digest was unchanged (`sha-600590b`), so there was no new image to verify. `publish-db` published the DB image as usual
