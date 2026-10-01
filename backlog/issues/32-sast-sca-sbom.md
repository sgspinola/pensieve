# 32: SAST/SCA (Semgrep) and SBOM gates

**What to build:** Every change is checked for injection/auth/unsafe-API bugs and for newly introduced vulnerable dependencies, and every build records exactly which production dependencies shipped. Add a `sast-sca` job running `semgrep ci` authenticated with `SEMGREP_APP_TOKEN`, so blocking is decided by the Semgrep dashboard policies for Code and Supply Chain; when the token is unavailable (fork PRs) it falls back to `semgrep scan` with `p/default`, `p/typescript`, `p/react`, `p/nextjs` and `p/owasp-top-ten`. Both paths emit SARIF to Code Scanning. Add an `sbom` job producing a CycloneDX SBOM of production dependencies only (`npm sbom --sbom-format cyclonedx --omit dev`), uploaded as an artifact with 90-day retention. Spec: `backlog/specs/10-ci-pipeline.md` (user stories 17–22, 38, 47).

**Blocked by:** 30 (workflow and `ci-ok` aggregate)

**Status:** ready-for-agent

- [ ] **sast-sca** runs `semgrep ci` when `SEMGREP_APP_TOKEN` is available
- [ ] Falls back to `semgrep scan` with the listed rulesets when the token is absent (fork PRs), without failing on the missing secret
- [ ] SARIF from either path uploaded to Code Scanning; step summary written
- [ ] **sbom** job generates a CycloneDX SBOM with dev dependencies omitted and uploads it with 90-day retention
- [ ] Both jobs included in `ci-ok`'s needs, with timeouts and SHA-pinned actions
- [ ] Verified both Semgrep paths run (token path on a same-repo PR once the secret exists; fallback path by running with the secret unset)
