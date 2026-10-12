# 51: Publish signed DB images to ECR on release

**What to build:** The DB image is released the same way as the app image, independently. A `publish-db` job in `db.yml` runs on every push to `main`, after every `db.yml` job. It assumes the ECR push role, pushes the scanned DB image as `sha-<short sha>` to `pensieve-db`, signs it keylessly with cosign, and attaches its CycloneDX SBOM as an OCI referrer, mirroring ticket 50. Spec: `backlog/specs/13-database-lifecycle.md` (user story 17; "publish-db").

**Blocked by:** 41 (DB image and `db.yml`), 50 (app publish mechanics to mirror/share)

**Status:** done

**Completed:** on `feat/51-db-image-publish`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/70

- [x] `publish-db` runs on every push to `main` (never on PRs), with `needs` listing every `db.yml` job, and pushes the already-scanned image without rebuilding
- [x] Tagged `sha-<short sha>` in `pensieve-db`, signed keylessly, with the signature and the DB image's own SBOM attached as OCI 1.1 referrers
- [x] Publish steps shared with ticket 50 where practical (e.g. a local composite action) rather than duplicated
- [x] Verified on the first release: tag present, `cosign verify` succeeds, SBOM listed. First release (2026-10-12, merge `3a0ad38`, PR #77): `publish-db` pushed `pensieve-db:sha-3a0ad38` (and `main`). `cosign verify` and `cosign verify-attestation --type cyclonedx` pass against `db.yml@refs/heads/main` (41 components). `cosign tree` lists the signature and the SBOM as OCI referrers, with no `sha256-*.sig` tags. The deploy-db role verified it too, in the first `deploy-db` run

**Implementation notes:**

- **Shared publish steps (item 3):** ticket 50's steps moved into a local composite action, `.github/actions/publish-image`, which handles login, push, the unchanged-skip, sign, SBOM attestation, moving `main` and the summary. It pins the crane and cosign images once. `ci.yml`'s `publish` and the new `db.yml` `publish-db` both call it, and each only checks out (needed to load a local action), downloads its two artifacts and passes the repository name. `ci.yml`'s behaviour is unchanged.
- **`publish-db`:** runs on a push to `main` only. It needs `db-image`, `db-apply` and `db-grants`, which is every current `db.yml` job; its comment says to add ticket 45's jobs. It publishes to `pensieve-db` as `sha-<7>`, signed keylessly, with the SBOM as a signed attestation, like the app. `deploy-db` verifies against the `db.yml@refs/heads/main` identity.
- **The DB image's SBOM** is built in `db-image`, so PRs exercise it too, and kept 90 days as `pensieve-db-sbom`. It's one CycloneDX document merging three sources, chosen by the maintainer:
  - the npm packages esbuild bundled: an esbuild metafile maps them to `name@version`, which is matched to `npm sbom`'s bom-refs, and any mismatch fails the job
  - Trivy's CycloneDX of the Debian packages
  - the Node runtime, from the image's own `node --version`, because Trivy can't see a tarball install

  The image's root entry depends on Node and on the direct npm dependencies.
- **Triggers:** per the maintainer, `db.yml` now also runs on `package.json`, `package-lock.json` and `tsconfig.json`, so a dependency bump republishes the DB image. Spec 13 and the docs are updated to match.
- **Verified locally:**
  - The real SBOM step ran in a clean `git archive` copy, with npm in the Dockerfile's pinned Node image. It found 25 bundled npm packages, 14 Debian packages and Node 24.21.0. The `bom-ref`s are unique, no dependency ref dangles, and Trivy parses the document.
  - A fake bundled package fails the step (jq exits 5).
  - The action's Push script handled the first-release, unchanged and re-run scenarios against a local registry.
  - actionlint, shellcheck on the action's scripts, typecheck, the docs build and Vitest (777) all pass.
- **Known limits, documented in `db.yml` and the docs:**
  - The DB image isn't built reproducibly, so every release that touches a DB input publishes, even one that only edits the workflow.
  - If a release's `publish-db` fails, re-run it. The next release that touches no DB input won't trigger `db.yml`.
- **Item 4 (first release):** check that `sha-*` is in `pensieve-db`, that `cosign verify` passes with identity `https://github.com/sgspinola/pensieve/.github/workflows/db.yml@refs/heads/main` and issuer `https://token.actions.githubusercontent.com`, and that `cosign verify-attestation --type cyclonedx` passes with the referrers listed. Do this together with ticket 50's first-release checks.
