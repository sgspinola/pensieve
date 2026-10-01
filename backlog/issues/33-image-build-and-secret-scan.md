# 33: Image build job with image secret scanning

**What to build:** CI builds the deployable arm64 image on every run and guarantees a leaking image is never downloadable from this public repository. A `build` job uses buildx on GitHub's native arm64 runner with the GitHub Actions layer cache. Before upload, the image is scanned for embedded secrets by Trivy (`--scanners secret` plus `--image-config-scanners secret`, covering every layer's files and ENV/labels/build-arg history) and TruffleHog's `docker` source (failing on verified, unknown and unverified). Any finding fails the job before `upload-artifact`; both SARIF files upload with `if: always()` so findings survive the failure they cause. Only a clean image is uploaded as a `docker save` tarball: 1-day retention as the hand-off to later jobs, 14 days on `develop` pushes as the deployable artifact. The lint job gains hadolint for the Dockerfile, and Dependabot learns to keep the base-image digest (and, later, Terraform providers) current. Spec: `backlog/specs/10-ci-pipeline.md` (user stories 12, 25, 26, 38, 42, 45, 47, 51, 54–57).

**Blocked by:** 29 (Dockerfile and image), 30 (CI workflow)

**Status:** ready-for-agent

- [ ] **build** job builds `linux/arm64` with buildx on an arm64 runner using the GitHub Actions cache
- [ ] Trivy secret scan (files + image config) and TruffleHog docker scan both run before any upload
- [ ] Any finding from either tool fails the job and no image artifact is uploaded
- [ ] Both SARIF results uploaded to Code Scanning with `if: always()` (job has `security-events: write`)
- [ ] Empty Trivy secret allow file and TruffleHog exclusions file exist, each documenting that entries need a reason and expiry
- [ ] Clean image uploaded as a `docker save` tarball: 1-day retention normally, 14-day retention on `push` to `develop`
- [ ] lint job also runs hadolint on the Dockerfile, and it passes
- [ ] Dependabot config gains the `docker` and `terraform` ecosystems, weekly, grouped minor/patch
- [ ] `build` added to ticket 36's required-checks list, ~20-minute timeout, step summary written
- [ ] Manually confirmed once on a throwaway branch: an image with a planted fake secret fails `build` and produces no artifact
