# 33: Image build job with image secret scanning

**What to build:** CI builds the deployable arm64 image on every run and guarantees a leaking image is never downloadable from this public repository. A `build` job uses buildx on GitHub's native arm64 runner with the GitHub Actions layer cache. Before upload, the image is scanned for embedded secrets by Trivy (`--scanners secret` plus `--image-config-scanners secret`, covering every layer's files and ENV/labels/build-arg history) with a custom rule for URLs with embedded credentials. Any finding fails the job before `upload-artifact`; the SARIF uploads with `if: always()` so findings survive the failure they cause. Only a clean image is uploaded as a `docker save` tarball: 1-day retention as the hand-off to later jobs, 14 days on `develop` pushes as the deployable artifact. The lint job gains hadolint for the Dockerfile, and Dependabot learns to keep the base-image digest (and, later, Terraform providers) current. Spec: `backlog/specs/10-ci-pipeline.md` (user stories 12, 25, 26, 38, 42, 45, 47, 51, 54–57).

**Blocked by:** 29 (Dockerfile and image), 30 (CI workflow)

**Status:** done

**Completed:** on `feat/33-image-build-and-secret-scan`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/19

- [x] **build** job builds `linux/arm64` with buildx on an arm64 runner using the GitHub Actions cache — via the runner's `docker buildx` CLI and a `type=local` cache persisted with `actions/cache` (restored every run, saved on pushes only): the repository's Actions policy allows only GitHub-owned actions, so `docker/build-push-action` failed the workflow at startup
- [x] Trivy secret scan (files + image config) runs before any upload, with a custom `url-embedded-credentials` rule. (Revised: a TruffleHog docker scan was built too, then dropped. It was the only scanner catching DSNs, and the custom Trivy rule now covers those.)
- [x] Any finding fails the job and no image artifact is uploaded
- [x] Trivy SARIF uploaded to Code Scanning with `if: always()` (job has `security-events: write`)
- [x] Trivy secret allow file exists, documenting that entries need a reason and expiry — `trivy-secret.yaml` has no allow rules, plus the custom DSN rule
- [x] Clean image uploaded as a `docker save` tarball: 1-day retention normally, 14-day retention on `push` to `develop`
- [x] lint job also runs hadolint on the Dockerfile, and it passes — after `USER nonroot` became `USER 65532:65532` (same distroless uid; DL3066)
- [x] Dependabot config gains the `docker` and `terraform` ecosystems, weekly, grouped minor/patch — terraform points at `/infra`, which Dependabot reports missing until spec 11 adds it
- [x] `build` added to ticket 36's required-checks list, ~20-minute timeout, step summary written — already listed there
- [x] Manually confirmed once on a throwaway branch: an image with a planted fake secret fails `build` and produces no artifact — once per tool: draft PR #18 (fake Postgres DSN file → TruffleHog) and #21 (fake GitHub PAT in `ENV` → Trivy's image-config scan; hadolint DL3064 flagged it too). Both: SARIF uploaded, `upload-artifact` skipped, 0 artifacts; closed after. After dropping TruffleHog, re-confirmed locally: a derived image with a fake Postgres DSN in a file and in `ENV` fails Trivy (exit 1) on the custom rule, and the real image is clean
