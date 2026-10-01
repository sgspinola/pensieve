# 31: Secret scanning in CI, plus a local pre-commit hook

**What to build:** Now that the repo is public, every change must be scanned for credentials before it merges, and most leaks should never reach GitHub at all. Add a `secrets` CI job running TruffleHog over the PR's commit range on `pull_request` and the pushed commit range on `push`, failing on verified, unknown and unverified results, with SARIF uploaded to Code Scanning. Add a `lefthook` pre-commit hook that runs TruffleHog over staged changes; both tools are installed via Homebrew and the one-time `lefthook install` is documented in the README (no npm `prepare` script, so nothing runs inside `npm ci` or the image build). Spec: `backlog/specs/10-ci-pipeline.md` (user stories 13–16, 38).

**Blocked by:** 30 (CI workflow)

**Status:** done

**Completed:** on `feat/31-secret-scanning`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/16

- [x] **secrets** job scans the PR commit range on `pull_request` and the pushed `before..after` range on `push` (revised from full history: see spec story 14) — both pass `--branch` (the PR head / pushed SHA), since without it TruffleHog also walks every other fetched ref
- [x] Job fails on verified, unknown and unverified findings (TruffleHog's own `--fail`); false positives use inline `trufflehog:ignore` comments, applied to the README's throwaway Postgres URL and the health-route test's fake DSN
- [x] SARIF uploaded to Code Scanning (job has `security-events: write`); step summary written
- [x] `secrets` added to ticket 36's required-checks list — already listed there
- [x] `lefthook` config runs TruffleHog on staged changes at pre-commit — `--since-commit HEAD --branch HEAD`; without `--branch` it also scanned stashes and failed on one
- [x] README documents installing TruffleHog and lefthook via Homebrew and running `lefthook install` once
- [x] No `prepare` script added to `package.json`
- [x] Manually confirmed: committing a fake secret locally is blocked by the hook — a staged fake Postgres DSN is rejected; with nothing staged it scans 0 chunks
- [x] README includes the "if a secret is found" response: rotate, delete affected artifacts/caches, treat run logs as exposed
