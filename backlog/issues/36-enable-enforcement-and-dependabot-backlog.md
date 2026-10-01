# 36: Turn on enforcement and clear the Dependabot backlog

**What to build:** Once the full pipeline is on `develop`, make it actually binding and run the waiting dependency bumps through it. Most steps are maintainer-only (repository settings and the Semgrep dashboard). The `develop`/`main` rulesets gain required status checks (`ci-ok`, plus `release-source` on `main`) with strict up-to-date enforcement; CodeQL default setup is enabled for `javascript-typescript` and `actions` as a non-blocking signal; the Semgrep token and blocking policies are configured; and the four Dependabot PRs opened before CI existed are validated by CI before merging. Spec: `backlog/specs/10-ci-pipeline.md` (user stories 2, 3, 19, 40, 41, 52, and the Further Notes' maintainer-only steps).

**Blocked by:** 30, 31, 32, 33, 34, 35

**Status:** ready-for-agent (maintainer-only steps marked)

- [ ] (maintainer) `SEMGREP_APP_TOKEN` repository secret added
- [ ] (maintainer) Semgrep dashboard blocking policies configured for Code and Supply Chain
- [ ] (maintainer) `protect-develop` requires `ci-ok`; `protect-main` requires `ci-ok` and `release-source`; both with "branches must be up to date"
- [ ] (maintainer) CodeQL default setup enabled for `javascript-typescript` and `actions`; findings confirmed non-blocking
- [ ] Verified a PR into `main` from a branch other than `develop` is blocked by `release-source`
- [ ] Dependabot PRs #1–#4 rebased so CI runs on them; patch bumps merged once green
- [ ] mermaid 11→12 PR merged only if `docs-build` passes and the diagrams render correctly locally (`npm run docs:dev`); otherwise closed with a note
