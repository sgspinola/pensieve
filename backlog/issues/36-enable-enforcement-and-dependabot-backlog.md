# 36: Turn on enforcement and clear the Dependabot backlog

**What to build:** Once the full pipeline is on `develop`, make it actually binding and run the waiting dependency bumps through it. Most steps are maintainer-only (repository settings and the Semgrep dashboard). The `develop`/`main` rulesets gain required status checks (every gate job by name, plus `release-source` on `main`) with strict up-to-date enforcement; CodeQL default setup is enabled for `javascript-typescript` and `actions` as a non-blocking signal; the Semgrep token and blocking policies are configured; and the four Dependabot PRs opened before CI existed are validated by CI before merging. Spec: `backlog/specs/10-ci-pipeline.md` (user stories 2, 3, 19, 40, 41, 52, and the Further Notes' maintainer-only steps).

**Blocked by:** 30, 31, 32, 33, 34, 35

**Status:** ready-for-agent (maintainer-only steps marked)

- [ ] (maintainer) `SEMGREP_APP_TOKEN` repository secret added
- [ ] (maintainer) Semgrep dashboard blocking policies configured for Code and Supply Chain
- [ ] (maintainer) `protect-develop` requires every gate job by name: `lint`, `typecheck`, `unit`, `docs-build`, `trufflehog`, `semgrep`, `sbom`, `build`, `trivy`, `e2e`. `protect-main` requires the same list plus `release-source`. Both use "branches must be up to date". Check the list against `.github/workflows/ci.yml`'s job names at the time, since there's no aggregate job to catch a missing one
- [ ] (maintainer) CodeQL default setup enabled for `javascript-typescript` and `actions`; findings confirmed non-blocking
- [ ] Verified a PR into `main` from a branch other than `develop` is blocked by `release-source`
- [ ] Dependabot PRs #1–#4 rebased so CI runs on them; patch bumps merged once green
- [ ] mermaid 11→12 PR merged only if `docs-build` passes and the diagrams render correctly locally (`npm run docs:dev`); otherwise closed with a note

**Progress (2026-10-02, on `feat/36-enable-enforcement-and-dependabot-backlog`):**

- `SEMGREP_APP_TOKEN` is present in the repository secrets. The Semgrep dashboard policies can't be checked from the API.
- Rulesets are only partly configured. Both are strict. `protect-develop` requires `lint`, `typecheck`, `unit`, `docs-build`, `e2e` and `trivy`, and is missing `trufflehog`, `semgrep`, `sbom` and `build`. `protect-main` requires `unit`, `typecheck`, `docs-build`, `lint` and `release-source`, and is missing `trufflehog`, `semgrep`, `sbom`, `build`, `trivy` and `e2e`. `ci.yml`'s jobs are `lint`, `typecheck`, `semgrep`, `sbom`, `unit`, `docs-build`, `trufflehog`, `release-source`, `build`, `trivy` and `e2e`.
- CodeQL default setup is still `not-configured`.
- Dependabot PRs #1–#4 have never had CI run (no checks reported). They still need `@dependabot rebase`.
- mermaid 11→12 (#1) is not mergeable. `vitepress-plugin-mermaid@2.0.17`, the latest release, declares peer `mermaid "10 || 11"`, so `npm ci` fails with ERESOLVE (verified locally with #1 merged onto `develop`). Close #1 with that note. mermaid 12 is deliberately not ignored in `.github/dependabot.yml`, so the update can be picked up as soon as a compatible plugin release exists.
