# 51: Publish signed DB images to ECR on release

**What to build:** The DB image is released the same way as the app image, independently. A `publish-db` job in `db.yml` runs on every push to `main`, after every `db.yml` job. It assumes the ECR push role, pushes the scanned DB image as `sha-<short sha>` to `pensieve-db`, signs it keylessly with cosign, and attaches its CycloneDX SBOM as an OCI referrer, mirroring ticket 50. Spec: `backlog/specs/13-database-lifecycle.md` (user story 17; "publish-db").

**Blocked by:** 41 (DB image and `db.yml`), 50 (app publish mechanics to mirror/share)

**Status:** ready-for-agent

- [ ] `publish-db` runs on every push to `main` (never on PRs), with `needs` listing every `db.yml` job, and pushes the already-scanned image without rebuilding
- [ ] Tagged `sha-<short sha>` in `pensieve-db`, signed keylessly, with the signature and the DB image's own SBOM attached as OCI 1.1 referrers
- [ ] Publish steps shared with ticket 50 where practical (e.g. a local composite action) rather than duplicated
- [ ] Verified on the first release: tag present, `cosign verify` succeeds, SBOM listed
