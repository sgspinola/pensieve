# 50: Publish signed app images to ECR on release

**What to build:** A release to `main` puts a verifiable app image in the registry. A `publish` job in `ci.yml` runs on every `push` to `main`, after every CI job of the workflow. It assumes the ECR push role via OIDC and pushes the exact image tarball the build job produced and the gates scanned and tested, without rebuilding. It tags it `sha-<short sha>` (plus a moving `main` tag only if ECR immutable-with-exclusions is supported), signs it keylessly with cosign, and attaches the build's CycloneDX SBOM as an OCI referrer. Spec: `backlog/specs/12-release-and-operations.md` (user stories 1–11; "`publish` job").

**Blocked by:** 46 (ECR push role), 48 (`pensieve` repository)

**Status:** in-review: merged; item 6 waits on a lifecycle preview after the signatures are a day old

- [x] `publish` runs on every push to `main` (never on PRs), with `needs` listing every CI job of `ci.yml`
- [x] Permissions limited to `id-token: write` and `contents: read`; authentication via OIDC only, no long-lived keys
- [x] Pushes the build artifact's bytes (no rebuild) as `sha-<short sha>`; the moving `main` tag decision is confirmed against the pinned provider and recorded; no `latest` or semver tags
- [x] Keyless cosign signature stored in ECR as an OCI 1.1 referrer (not a legacy `sha256-….sig` tag); the SBOM is attached as an OCI 1.1 referrer
- [x] Verified on the first release: image present, `cosign verify` succeeds with the expected identity and issuer, SBOM referrer listed. First release (2026-10-12, merge `3a0ad38`, PR #77): `pensieve:sha-3a0ad38` (and `main`). `cosign verify` and `cosign verify-attestation --type cyclonedx` pass against `ci.yml@refs/heads/main` and GitHub's issuer (190 components). `cosign tree` lists both referrers, with no `sha256-*.sig` tags. The deploy-app role verified it too, in the first `deploy-app` run
- [ ] ECR lifecycle evaluation is confirmed not to remove kept images' signatures or SBOMs (adjust the ticket 48 rules if it does). A preview on 2026-10-12 selected nothing in either repository, but the referrers were minutes old, and the untagged rule only applies after a day. Re-run `aws ecr start-lifecycle-policy-preview` on both repositories after 2026-10-12
- [x] A later release touching no app inputs publishes no new app image. Release #82 (merge `a98a8d4`, 2026-10-12) changed only DB inputs and backlog files: `publish` pushed nothing to `pensieve`, where `main` still points at `sha-3a0ad38`, while `publish-db` published `pensieve-db:sha-a98a8d4`

**Implementation notes:**

- **The `publish` job:** at the end of `ci.yml`. `needs` lists all 11 jobs except `release-source`, which runs only on PRs (a skipped need would skip `publish`), and the `ci.yml` header now says every new job belongs in `needs` too. Authentication is OIDC → STS → `docker login` for ECR; only the ECR login token leaves that step. crane and cosign run as digest-pinned images, like Terraform does in `iac`.
- **No rebuild:** `crane push` sends the build job's `docker save` tarball. The config digest in ECR is the one that was tested; checked locally against an OCI registry.
- **`main` tag:** ticket 48's `IMMUTABLE_WITH_EXCLUSION` allows it, so `main` moves to each new release, but only after the signature and attestation exist. `sha-*` uses the commit SHA's first 7 characters.
- **Signing:** keyless cosign 3.1.3. The SBOM is a **signed attestation** (`cosign attest --type cyclonedx`), per the maintainer's choice. A local test against an OCI 1.1 registry (zot) showed both stored as referrers (Sigstore bundle v0.3), with no `sha256-*.sig` tags, and `cosign verify`/`verify-attestation` read them back.
- **Unchanged releases (item 7):** the maintainer chose to skip publishing, which restores user story 11. Spec 12's contradictory revised line is corrected to match.
  - The root `.dockerignore` now leaves out everything the app isn't built from: `backlog`, `docs`, `infra`, `db`, `e2e`, `.github`, tests, tooling config and root `*.md`.
  - The build uses `SOURCE_DATE_EPOCH=0`.
  - Verified locally: two CI-style builds around a backlog-only change gave different config digests before the change (red) and identical ones after (green).
  - `publish` compares the tarball's config digest with the config digest of `main`'s image, and pushes nothing if they match.
  - This only holds with a warm layer cache. On a miss, Next's random build ID changes the image, and an unchanged release publishes a functionally identical new image.
- **The DB image's build context:** it now has its own `db/Dockerfile.dockerignore`, the old root denylist, because the root file excludes `db/`. BuildKit uses it instead of the root file, and the DB image builds locally. `db.yml` no longer triggers on the root `.dockerignore`.
- **Local harness for the Push step:** the real step script, extracted from `ci.yml`, ran against a local registry for three cases: the first release (pushes `sha-*`, `main` follows), an unchanged release (pushes and tags nothing), and a re-run with the tag already pushed (reuses the digest).
- **Manual, before the first release:** set the repository variable `ECR_PUSH_ROLE_ARN` to the bootstrap output `role_arns.ecr_push`. Also, `trivy` must pass on `main`, which needs the `next` 16.3.8 bump; `publish` needs every job.
- **To check on the first release (items 5–6):**
  - The image is present, `cosign verify` passes with identity `https://github.com/sgspinola/pensieve/.github/workflows/ci.yml@refs/heads/main` and issuer `https://token.actions.githubusercontent.com`, and `cosign verify-attestation --type cyclonedx` passes.
  - The referrers are listed in ECR (not just in the local registry).
  - The public Rekor log accepts the ~230 KB SBOM attestation.
  - `aws ecr start-lifecycle-policy-preview` doesn't select the signature or attestation. They're untagged manifests, and ticket 48's rule 2 expires untagged images after a day.
- **For `deploy-app` (ticket 52):** a release that changed nothing, or a middle push that GitHub's concurrency group cancelled while pending, has no `sha-*` tag. Deploys should expect only commits whose image was published.
