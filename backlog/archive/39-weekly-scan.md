# 39: Weekly scheduled vulnerability scan

**What to build:** A weekly scheduled run re-checks unchanged code for newly published CVEs. On a `schedule` event the workflow runs only `trivy` (and the `build` it needs), `semgrep-sca` and `sbom`, and nothing is published from that run. Findings land in Code Scanning like any other run. Spec: `backlog/specs/10-ci-pipeline.md` (Workflow structure triggers revision; Out of Scope "scheduled run" revision).

**Blocked by:** 38 (path-conditional jobs and `gate`)

**Status:** wontfix

**Why not:** dropped by the maintainer (decision 2026-10-04). A scheduled re-scan of unchanged code only adds value for SCA, and Dependabot already covers that: npm security updates, and the Dockerfile's base-image digest bumps that bring in Debian package fixes. Ticket 38, whose job selection this relied on, is also `wontfix`.

- [ ] `ci.yml` has a weekly `schedule` trigger
- [ ] On `schedule`, only `build`, `trivy`, `semgrep-sca` and `sbom` (plus `changes`/`gate` as needed) run. Lint, unit, e2e and the other jobs are skipped
- [ ] No artifact retention beyond the normal hand-off, and no publish or deploy step can run on `schedule`
- [ ] Scanner SARIF from the scheduled run reaches Code Scanning, and the run summary states it was a scheduled scan
- [ ] Verified with a manual trigger (e.g. a temporary `workflow_dispatch`, or by waiting for the first scheduled run)
