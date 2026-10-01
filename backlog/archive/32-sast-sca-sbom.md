# 32: SAST/SCA (Semgrep) and SBOM gates

**What to build:** Every change is checked for injection/auth/unsafe-API bugs and for newly introduced vulnerable dependencies, and every build records exactly which production dependencies shipped. Add a `sast-sca` job running `semgrep ci` authenticated with `SEMGREP_APP_TOKEN`, so blocking is decided by the Semgrep dashboard policies for Code and Supply Chain; when the token is unavailable (fork PRs) it falls back to `semgrep scan` with `p/default`, `p/typescript`, `p/react`, `p/nextjs` and `p/owasp-top-ten`. Both paths emit SARIF to Code Scanning. Add an `sbom` job producing a CycloneDX SBOM of production dependencies only (`npm sbom --sbom-format cyclonedx --omit dev`), uploaded as an artifact with 90-day retention. Spec: `backlog/specs/10-ci-pipeline.md` (user stories 17–22, 38, 47).

**Blocked by:** 30 (CI workflow)

**Status:** done

**Completed:** on `feat/32-sast-sca-sbom`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/17

- [x] **semgrep** (originally `sast-sca`) runs `semgrep ci` when `SEMGREP_APP_TOKEN` is available
- [x] Falls back to `semgrep scan` with the listed rulesets when the token is absent (fork PRs), without failing on the missing secret — blocking on any finding (`--error`). The rulesets flagged three pre-existing supply-chain settings, fixed rather than suppressed: `.npmrc` gains `min-release-age=7`, and both Dependabot ecosystems a matching 7-day cooldown
- [x] SARIF from either path uploaded to Code Scanning; step summary written
- [x] **sbom** job generates a CycloneDX SBOM with dev dependencies omitted and uploads it with 90-day retention
- [x] Both jobs added to ticket 36's required-checks list, with timeouts and SHA-pinned actions — already listed there; Semgrep runs as a digest-pinned container. Note the SARIF upload also creates a "Semgrep PRO"/"Semgrep OSS" Code Scanning check; that one isn't a gate
- [x] Verified both Semgrep paths run (token path on a same-repo PR once the secret exists; fallback path by running with the secret unset) — token path on PR #17 (`semgrep ci`, 0 blocking); fallback on throwaway draft PR #20 with the token blanked (`semgrep scan`, 263 rules, 0 findings, SARIF uploaded), closed after
