# 33: Image build job with image secret scanning

**What to build:** CI builds the deployable arm64 image on every run and guarantees a leaking image is never downloadable from this public repository. A `build` job uses buildx on GitHub's native arm64 runner with the GitHub Actions layer cache. Before upload, the image is scanned for embedded secrets by Trivy (`--scanners secret` plus `--image-config-scanners secret`, covering every layer's files and ENV/labels/build-arg history) and TruffleHog's `docker` source (failing on verified, unknown and unverified). Any finding fails the job before `upload-artifact`; both SARIF files upload with `if: always()` so findings survive the failure they cause. Only a clean image is uploaded as a `docker save` tarball: 1-day retention as the hand-off to later jobs, 14 days on `develop` pushes as the deployable artifact. The lint job gains hadolint for the Dockerfile, and Dependabot learns to keep the base-image digest (and, later, Terraform providers) current. Spec: `backlog/specs/10-ci-pipeline.md` (user stories 12, 25, 26, 38, 42, 45, 47, 51, 54–57).

**Blocked by:** 29 (Dockerfile and image), 30 (CI workflow)

**Status:** done

**Completed:** on `feat/33-image-build-and-secret-scan`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/19

- [x] **build** job builds `linux/arm64` with buildx on an arm64 runner using the GitHub Actions cache — via the runner's `docker buildx` CLI and a `type=local` cache persisted with `actions/cache` (restored every run, saved on pushes only): the repository's Actions policy allows only GitHub-owned actions, so `docker/build-push-action` failed the workflow at startup
- [x] Trivy secret scan (files + image config) and TruffleHog docker scan both run before any upload
- [x] Any finding from either tool fails the job and no image artifact is uploaded
- [x] Both SARIF results uploaded to Code Scanning with `if: always()` (job has `security-events: write`)
- [x] Empty Trivy secret allow file and TruffleHog exclusions file exist, each documenting that entries need a reason and expiry — `trivy-secret.yaml` is empty; `.github/trufflehog-image-exclude.txt` has one entry, since the distroless base's dpkg `*.md5sums` lists trip TruffleHog's Box detector on every build. The docker source takes `--exclude-paths` as a comma-separated glob list, so the file holds `<glob> <expiry> <reason>` lines and the job joins the unexpired ones
- [x] Clean image uploaded as a `docker save` tarball: 1-day retention normally, 14-day retention on `push` to `develop`
- [x] lint job also runs hadolint on the Dockerfile, and it passes — after `USER nonroot` became `USER 65532:65532` (same distroless uid; DL3066)
- [x] Dependabot config gains the `docker` and `terraform` ecosystems, weekly, grouped minor/patch — terraform points at `/infra`, which Dependabot reports missing until spec 11 adds it
- [x] `build` added to ticket 36's required-checks list, ~20-minute timeout, step summary written — already listed there
- [x] Manually confirmed once on a throwaway branch: an image with a planted fake secret fails `build` and produces no artifact — once per tool: draft PR #18 (fake Postgres DSN file → TruffleHog) and #21 (fake GitHub PAT in `ENV` → Trivy's image-config scan; hadolint DL3064 flagged it too). Both: SARIF uploaded, `upload-artifact` skipped, 0 artifacts; closed after
