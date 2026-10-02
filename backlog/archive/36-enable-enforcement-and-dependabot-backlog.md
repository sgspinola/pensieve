# 36: Turn on enforcement and clear the Dependabot backlog

**What to build:** Once the full pipeline is on `develop`, make it actually binding and run the waiting dependency bumps through it. Most steps are maintainer-only (repository settings and the Semgrep dashboard). The `develop`/`main` rulesets gain required status checks (every gate job by name, plus `release-source` on `main`) with strict up-to-date enforcement; CodeQL default setup is enabled for `javascript-typescript` and `actions` as a non-blocking signal; the Semgrep token and blocking policies are configured; and the four Dependabot PRs opened before CI existed are validated by CI before merging. Spec: `backlog/specs/10-ci-pipeline.md` (user stories 2, 3, 19, 40, 41, 52, and the Further Notes' maintainer-only steps).

**Blocked by:** 30, 31, 32, 33, 34, 35

**Status:** done

**Completed:** on `feat/36-enable-enforcement-and-dependabot-backlog`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/26

- [x] (maintainer) `SEMGREP_APP_TOKEN` repository secret added
- [ ] (maintainer) Semgrep dashboard blocking policies configured for Code and Supply Chain
- [x] (maintainer) `protect-develop` requires every gate job by name: `lint`, `typecheck`, `unit`, `docs-build`, `trufflehog`, `semgrep`, `sbom`, `build`, `trivy`, `e2e`. `protect-main` requires the same list plus `release-source`. Both use "branches must be up to date". Check the list against `.github/workflows/ci.yml`'s job names at the time, since there's no aggregate job to catch a missing one
- [x] (maintainer) CodeQL default setup enabled for `javascript-typescript` and `actions`; findings confirmed non-blocking
- [x] Verified a PR into `main` from a branch other than `develop` is blocked by `release-source`
- [ ] Dependabot PRs #1–#4 rebased so CI runs on them; patch bumps merged once green
- [x] mermaid 11→12 PR merged only if `docs-build` passes and the diagrams render correctly locally (`npm run docs:dev`); otherwise closed with a note

**Outcome (2026-10-02):** The maintainer closed the ticket out with the two unchecked items above still open:

- The `SEMGREP_APP_TOKEN` secret is set. The dashboard blocking policies weren't confirmed from here, since the API can't see them.
- Both rulesets are strict and require every `ci.yml` gate job by name. `protect-main` also requires `release-source`.
- CodeQL default setup is configured for `actions` and `javascript-typescript`. It isn't a required check, so it doesn't block merges.
- `release-source` was verified with #25: a PR into `main` from `dependabot/npm_and_yarn/dotenv-18.0.4` failed the check and was blocked.
- mermaid 11→12 (#1) was closed. `vitepress-plugin-mermaid@2.0.17`, the latest release, declares peer `mermaid "10 || 11"`, so `npm ci` fails with ERESOLVE. mermaid 12 is deliberately not ignored in `.github/dependabot.yml`, so it can land once a compatible plugin release exists. Merge that plugin bump first.
- Patch bumps: CI ran green on dotenv (#2), which is still open pending review. Dependabot closed #3 (`@simplewebauthn/server`) and #4 (`@types/node`) as "up-to-date", but `develop` is still on 14.0.2 and 26.6.2, so those bumps haven't landed.
- Follow-up: on #25, `trufflehog` scanned all of `develop`'s history since `main` and flagged 3 unverified Postgres URLs. They're the README's throwaway Docker credentials and `route.test.ts`'s fake DSN. These lines are now marked `trufflehog:ignore`, but the commits that added them predate the marker, so the first develop→main release PR will fail `trufflehog` until that's handled.
