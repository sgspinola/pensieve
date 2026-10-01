# 12: Release publishing, deployment and operational runbooks

## Problem Statement

Once CI produces a gated, scanned image (spec 10) and the AWS environment exists (spec 11), there's still no way to ship. Nothing puts an approved image into the registry, nothing proves an image in the registry actually came from this pipeline, and no procedure takes a new version from the registry to the running service while applying database migrations safely. There's also no written procedure for the operations the maintainer will eventually need under pressure: bootstrapping the environment from an empty account, rolling out a release, and restoring the database. RDS restores always produce a *new* instance, so recovery is a multi-step procedure, not a button.

The maintainer has decided against continuous deployment for now. Deploys are run deliberately from their own machine. A few minutes of downtime per release are acceptable, which keeps migrations simple: there's no need to keep old and new versions compatible.

## Solution

On every push to `main` (which only receives release PRs from `develop`), a `publish` job that depends on every CI gate:
- pushes the image to ECR, authenticating via GitHub OIDC
- signs it keylessly with cosign
- attaches the build's CycloneDX SBOM to it as an OCI referrer

Images are tagged with the short commit SHA plus a moving `main` tag.

Deploys are a single local script run with the maintainer's SSO credentials. It takes a commit SHA and performs a short maintenance-window rollout:
1. scale the service to zero
2. snapshot the database
3. run the migration one-off task and wait for success
4. register the new app task definition and scale back to one, waiting until stable

A separate migrate script can run migrations on their own. The app's startup schema check and ECS's circuit breaker (spec 11) back this up: a deploy that skipped migrating fails fast and rolls back.

The documentation site gains pages describing the CI pipeline and the AWS deployment architecture, plus runbooks for bootstrap, deploy and restore. The docs methodology notes record how each was produced.

## User Stories

1. As the maintainer, I want images published to ECR only from `main`, so that the registry contains only released versions.
2. As the maintainer, I want publishing to depend on every CI gate passing, so that nothing unscanned or untested can ever reach the registry.
3. As the maintainer, I want CI to authenticate to AWS via OIDC with a role that only `main` can assume, so that no long-lived AWS keys exist in GitHub and PRs can never publish.
4. As the maintainer, I want every published image tagged with its commit SHA, so that I can deploy and roll back to exact versions.
5. As the maintainer, I want a moving `main` tag as well, so that I can see which image is the latest release.
6. As the maintainer, I want no `latest` tag and no semver tags for now, so that tags are never ambiguous and I don't need a release-numbering process yet.
7. As the maintainer, I want every published image signed with cosign using the workflow's GitHub OIDC identity, so that I (and later CD) can verify an image was built by this repository's `main` pipeline.
8. As the maintainer, I want signing to need no key management, so that there's no signing key to protect, rotate or leak.
9. As the maintainer, I want the build's SBOM attached to the image in the registry, so that the dependency record travels with the artifact it describes.
10. As the maintainer, I want registry lifecycle cleanup to keep each kept image's signature and SBOM, so that old-but-kept images stay verifiable.
11. As the maintainer, I want to deploy any published commit with one command, so that releasing isn't a fiddly manual sequence.
12. As the maintainer, I want the deploy to run from my machine with my SSO credentials, so that no CI identity can deploy until I deliberately add CD.
13. As the maintainer, I want the deploy to stop the running app before migrating, so that migrations never run against a live app and never need to be compatible with two versions.
14. As the maintainer, I want a database snapshot taken right before each migration, so that a destructive migration can be undone by restoring.
15. As the maintainer, I want the deploy to wait for the migration task to succeed and abort if it fails, so that a new app version never starts on a half-migrated schema.
16. As the maintainer, I want the deploy to wait until the new version is stable and report clearly if it isn't, so that I know whether the release actually worked.
17. As the maintainer, I want deploys to register new task-definition revisions rather than go through Terraform, so that a routine release never needs `terraform apply` or touches infrastructure.
18. As the maintainer, I want a way to run migrations on their own, so that I can re-run or test a migration without a full deploy.
19. As the maintainer, I want the app to refuse to start if migrations are pending, so that forgetting to migrate causes an automatic rollback rather than a broken app.
20. As the maintainer, I want deploy downtime to be a few minutes, so that the maintenance-window approach stays acceptable.
21. As the maintainer, I want a written bootstrap runbook covering everything from an empty AWS account to a running app, so that I (or a future me) can rebuild the environment without rediscovering the steps.
22. As the maintainer, I want the runbook to list every manual prerequisite (Identity Center, Cloudflare tokens, the GitHub Environment and secrets, the Semgrep token, CodeQL and rulesets), so that nothing is silently assumed.
23. As the maintainer, I want a written deploy runbook, so that I know what the script does, what downtime to expect, and what to do when a step fails.
24. As the maintainer, I want a written restore runbook covering point-in-time recovery and restoring a pre-deploy snapshot, so that recovery under pressure follows a tested procedure.
25. As the maintainer, I want the restore runbook to explain that a restore creates a new instance and how to point the app at it, so that I'm not surprised mid-incident.
26. As the maintainer, I want to practise a restore once after the first real deploy, so that I know the procedure works before I need it.
27. As the maintainer, I want rollback after a destructive migration documented as "restore the pre-deploy snapshot, then deploy the previous SHA", so that I'm not misled into thinking redeploying the old image is enough.
28. As a reader of the docs, I want a page describing the CI pipeline and its gates, so that I understand what protects each change.
29. As a reader of the docs, I want a page describing the AWS deployment architecture with a diagram, so that I understand how a request reaches the app and the database.
30. As the maintainer, I want the docs methodology notes updated to record how these pages were produced, so that the existing docs conventions stay consistent.

## Implementation Decisions

**`publish` job** (added to the spec 10 workflow):
- Runs only on `push` to `main` and needs every gate job, so it can't run unless every gate passed.
- Permissions: `id-token: write` (OIDC) and `contents: read`.
- Assumes the ECR push role (spec 11) via GitHub OIDC, and pushes the already-built and already-scanned image from the build job's artifact rather than rebuilding it, so the published bytes are exactly the bytes that were tested.
- **Tags:** `sha-<short sha>` (immutable, the deployable reference) and `main` (moving). Plain ECR tag immutability forbids a moving tag. Use ECR's immutable-with-exclusions mode (exclusion filter for `main`) if the pinned AWS provider supports it. Otherwise drop the moving tag, so `sha-*` tags always stay immutable. Confirm against the provider when implementing.
- **Signing:** keyless cosign, using the workflow's OIDC identity. The signature is stored in ECR alongside the image, and the transparency-log entry goes to the public Rekor log (acceptable, since the repo is public).
- **SBOM:** the CycloneDX SBOM from the build's `sbom` job is attached to the image as an OCI referrer.

**Deploy and migrate scripts** (run locally with the AWS CLI and SSO credentials):
- **Deploy script:** takes a commit SHA and runs these steps, aborting on the first failure with a clear message:
  1. confirm `sha-<sha>` exists in ECR
  2. scale the service to 0 and wait until no task is running
  3. take a manual RDS snapshot named after the SHA and timestamp, and wait until it's available
  4. register a new migrate task-definition revision with that image, run it as a one-off task in the service's subnets and security group, and wait for exit code 0
  5. register a new app task-definition revision with that image, update the service to use it with a desired count of 1, and wait until the service is stable
- **Migrate script:** runs only the migration one-off task for a given SHA.
- Neither script calls Terraform. The service ignores task-definition changes in Terraform (spec 11).
- **Expected downtime:** a few minutes (snapshot, migration, then Fargate cold start). During that time Cloudflare serves its default origin-unavailable page.

**Documentation** (VitePress docs site, following the existing conventions):
- An architecture page for the CI pipeline: jobs, gates, the rulesets' required checks, where findings go, and what's published from where.
- An architecture page for the AWS deployment: the request path Cloudflare → Tunnel → `cloudflared` sidecar → app → RDS over IAM auth, plus the network layout, roles and cost structure, with Mermaid diagrams.
- Operations runbooks:
  - **Bootstrap:** prerequisites, applying bootstrap, applying prod, running db-bootstrap, the first deploy, and the maintainer-only GitHub/Semgrep/CodeQL steps.
  - **Deploy:** what the script does, expected downtime, failure handling, rollback.
  - **Restore:** point-in-time recovery, restoring a snapshot to a new instance, repointing the app, and when to use each.
- The docs methodology notes gain entries for these pages. Per the existing convention, the architecture pages are kept in sync using the repository's own knowledge graph (graphify) where it applies, and by direct reading of the Terraform and workflow sources where the graph doesn't cover them. Record that limitation in the methodology notes, not in the pages themselves.

## Testing Decisions

- **Good tests here are real runs.** These are release and operations mechanics, not app logic, so there's no new unit-test seam in this spec.
- **Publishing** is verified by the first push to `main` after the release PR:
  - the image appears in ECR with its `sha-*` tag
  - `cosign verify`, using the expected GitHub OIDC identity and issuer, succeeds
  - the SBOM referrer is listed for the image
  - ECR lifecycle evaluation doesn't remove the signature or SBOM of kept images
- **Deploy and migrate scripts** are verified by the first real deploy, following the bootstrap and deploy runbooks step by step.
- **Restore** is verified by one deliberate practice restore after the first deploy, following the restore runbook. Any discrepancy found becomes a runbook fix.
- **App-side safety nets** are already tested in spec 11 (the startup schema check) and spec 10 (the health endpoint, e2e against the image).
- **Docs pages** are verified by CI's `docs-build` gate.

## Out of Scope

- Continuous deployment (an automated deploy job, its OIDC deploy role, and verifying signatures at deploy time).
- Zero-downtime deploys and expand/contract migration discipline. Neither is needed with the maintenance-window approach.
- A Cloudflare-hosted maintenance page during deploys.
- Release versioning (semver tags, changelogs, GitHub Releases).
- Image signature verification enforced by ECS.
- A "panic button" for stopping compute when a budget is exceeded.
- Publishing the docs site (GitHub Pages or `docs.pensieve.fyi`).

## Further Notes

- **Branch flow:** feature work lands on `develop` by squash merge. Releases are PRs from `develop` into `main`, merged with a merge commit (the only method the `main` ruleset allows) so the two branches never diverge. A push to `main` is therefore what "release" means, and is what triggers `publish`.
- **Migration strategy alternatives considered and rejected** for the maintenance-window approach:
  - an init container in the task definition, which runs on every task start and races if more than one task runs
  - migrating on app startup, which has the same race and slows startup
  - running migrations from the CI runner, which can't reach the private RDS instance
  - The one-off task was chosen.
- When CD is added later, the deploy script's steps become the CD job almost verbatim, plus a `cosign verify` before deploying and a dedicated deploy role.

This spec came out of the same `grill-me` session as specs 10 and 11.
