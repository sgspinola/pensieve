# 31: Secret scanning in CI, plus a local pre-commit hook

**What to build:** Now that the repo is public, every change must be scanned for credentials before it merges, and most leaks should never reach GitHub at all. Add a `secrets` CI job running TruffleHog over the PR's commit range on `pull_request` and the full git history on `push`, failing on verified, unknown and unverified results, with SARIF uploaded to Code Scanning. Add a `lefthook` pre-commit hook that runs TruffleHog over staged changes; both tools are installed via Homebrew and the one-time `lefthook install` is documented in the README (no npm `prepare` script, so nothing runs inside `npm ci` or the image build). Spec: `backlog/specs/10-ci-pipeline.md` (user stories 13–16, 38).

**Blocked by:** 30 (CI workflow)

**Status:** ready-for-agent

- [ ] **secrets** job scans the PR commit range on `pull_request` and full history on `push`
- [ ] Job fails on verified, unknown and unverified findings
- [ ] SARIF uploaded to Code Scanning (job has `security-events: write`); step summary written
- [ ] `secrets` added to ticket 36's required-checks list
- [ ] `lefthook` config runs TruffleHog on staged changes at pre-commit
- [ ] README documents installing TruffleHog and lefthook via Homebrew and running `lefthook install` once
- [ ] No `prepare` script added to `package.json`
- [ ] Manually confirmed: committing a fake secret locally is blocked by the hook
- [ ] README includes the "if a secret is found" response: rotate, delete affected artifacts/caches, treat run logs as exposed
