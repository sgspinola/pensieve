# 50: Publish signed app images to ECR on release

**What to build:** A release to `main` puts a verifiable app image in the registry. A `publish` job in `ci.yml` runs on every `push` to `main`, after every CI job of the workflow. It assumes the ECR push role via OIDC and pushes the exact image tarball the build job produced and the gates scanned and tested, without rebuilding. It tags it `sha-<short sha>` (plus a moving `main` tag only if ECR immutable-with-exclusions is supported), signs it keylessly with cosign, and attaches the build's CycloneDX SBOM as an OCI referrer. Spec: `backlog/specs/12-release-and-operations.md` (user stories 1–11; "`publish` job").

**Blocked by:** 46 (ECR push role), 48 (`pensieve` repository)

**Status:** ready-for-agent

- [ ] `publish` runs on every push to `main` (never on PRs), with `needs` listing every CI job of `ci.yml`
- [ ] Permissions limited to `id-token: write` and `contents: read`; authentication via OIDC only, no long-lived keys
- [ ] Pushes the build artifact's bytes (no rebuild) as `sha-<short sha>`; the moving `main` tag decision is confirmed against the pinned provider and recorded; no `latest` or semver tags
- [ ] Keyless cosign signature stored in ECR as an OCI 1.1 referrer (not a legacy `sha256-….sig` tag); the SBOM is attached as an OCI 1.1 referrer
- [ ] Verified on the first release: image present, `cosign verify` succeeds with the expected identity and issuer, SBOM referrer listed
- [ ] ECR lifecycle evaluation is confirmed not to remove kept images' signatures or SBOMs (adjust the ticket 48 rules if it does)
- [ ] A later release touching no app inputs publishes no new app image
