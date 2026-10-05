# 12: Release publishing, deployment and operational runbooks

## Problem Statement

Once CI produces a gated, scanned image (spec 10) and the AWS environment exists (spec 11), there's still no way to ship:
- Nothing puts an approved image into the registry.
- Nothing proves an image in the registry actually came from this pipeline.
- Nothing takes a new version from the registry to the running service.

There's also no written procedure for the operations the maintainer will eventually need under pressure: bootstrapping the environment from an empty account, rolling out a release, and restoring the database. RDS restores always produce a *new* instance, so recovery is a multi-step procedure, not a button.

Deploys are deliberate. Nothing deploys automatically, and each deploy needs the maintainer's approval. A few minutes of downtime per deploy are acceptable. The database has its own lifecycle (spec 13), so an app release no longer migrates the schema. This spec covers the app side and the runbooks spanning both.

## Solution

On every push to `main` (which only receives release PRs from `develop`), a `publish` job that needs every CI job of the workflow:
- pushes the image to ECR, authenticating via GitHub OIDC
- signs it keylessly with cosign
- attaches the build's CycloneDX SBOM to it as an OCI referrer

Images are tagged with the short commit SHA plus a moving `main` tag. The DB image is published the same way by `db.yml` (spec 13).

App deploys are a **manually dispatched `deploy-app` workflow** that the maintainer must approve. It takes an app commit SHA, verifies the image's signature, registers a new task-definition revision and updates the service, waiting until it's stable. It never touches the database. Schema changes go through `deploy-db` (spec 13). A breaking migration's coordinated window, which also starts the new app version, is `deploy-db`'s job. The app's two-sided startup schema check (spec 13) and ECS's circuit breaker (spec 11) back this up: an app deployed before its migration fails fast and rolls back.

The documentation site gains pages describing the CI pipeline and the AWS deployment architecture, plus runbooks for bootstrap, deploy and restore. The docs methodology notes record how each was produced.

## User Stories

1. As the maintainer, I want images published to ECR only from `main`, so that the registry contains only released versions.
2. As the maintainer, I want publishing to depend on every CI gate passing, so that nothing unscanned or untested can ever reach the registry.
3. As the maintainer, I want CI to authenticate to AWS via OIDC with a role that only `main` can assume, so that no long-lived AWS keys exist in GitHub and PRs can never publish.
4. As the maintainer, I want every published image tagged with its commit SHA, so that I can deploy and roll back to exact versions.
5. As the maintainer, I want a moving `main` tag as well, so that I can see which image is the latest release.
6. As the maintainer, I want no `latest` tag and no semver tags for now, so that tags are never ambiguous and I don't need a release-numbering process yet.
7. As the maintainer, I want every published image signed with cosign using the workflow's GitHub OIDC identity, so that the deploy workflows can verify an image was built by this repository's `main` pipeline.
8. As the maintainer, I want signing to need no key management, so that there's no signing key to protect, rotate or leak.
9. As the maintainer, I want the build's SBOM attached to the image in the registry, so that the dependency record travels with the artifact it describes.
10. As the maintainer, I want registry lifecycle cleanup to keep each kept image's signature and SBOM, so that old-but-kept images stay verifiable.
11. As the maintainer, I want a release that didn't change the app to publish no new app image, so that the registry's `sha-*` tags mark real app versions.
12. As the maintainer, I want to deploy any published app commit by dispatching one workflow, so that releasing isn't a fiddly manual sequence and doesn't depend on my laptop.
13. As the maintainer, I want every app deploy to wait for my approval in a protected GitHub Environment, so that nothing reaches production without a deliberate decision.
14. As the maintainer, I want the app deploy to verify the image's cosign signature before using it, so that only images built by this repository's `main` pipeline can run.
15. As the maintainer, I want an app deploy never to snapshot or migrate the database, so that app releases carry no schema risk and need no database permissions.
16. As the maintainer, I want the deploy to wait until the new version is stable and report clearly if it isn't, so that I know whether the release actually worked.
17. As the maintainer, I want deploys to register new task-definition revisions rather than go through Terraform, so that a routine release never needs `terraform apply` or touches infrastructure.
18. As the maintainer, I want an app deployed before its migration to fail its startup check and roll back automatically, so that deploying in the wrong order costs only a short outage (spec 13).
19. As the maintainer, I want the first deploy order (bootstrap, DB deploy, app deploy) written down, so that the initial empty-schema state isn't a puzzle.
20. As the maintainer, I want deploy downtime to be a few minutes, so that the maintenance-window approach stays acceptable.
21. As the maintainer, I want a written bootstrap runbook covering everything from an empty AWS account to a running app, so that I (or a future me) can rebuild the environment without rediscovering the steps.
22. As the maintainer, I want the runbook to list every manual prerequisite (Identity Center, Cloudflare tokens, the GitHub Environments and secrets, the Semgrep token, CodeQL and rulesets), so that nothing is silently assumed.
23. As the maintainer, I want a written deploy runbook covering app-only deploys, DB-only deploys and the breaking-migration window, so that I know which workflow to dispatch, what downtime to expect, and what to do when a step fails.
24. As the maintainer, I want a written restore runbook covering point-in-time recovery and restoring a pre-deploy snapshot, so that recovery under pressure follows a tested procedure.
25. As the maintainer, I want the restore runbook to explain that a restore creates a new instance and how to point the app at it, so that I'm not surprised mid-incident.
26. As the maintainer, I want to practise a restore once after the first real deploy, so that I know the procedure works before I need it.
27. As the maintainer, I want rollback after a breaking migration documented as "restore the pre-deploy snapshot, then dispatch `deploy-app` with the previous SHA", so that I'm not misled into thinking redeploying the old image is enough. The startup check will refuse it on the new schema.
28. As a reader of the docs, I want a page describing the CI pipeline and its gates, so that I understand what protects each change.
29. As a reader of the docs, I want a page describing the AWS deployment architecture with a diagram, so that I understand how a request reaches the app and the database.
30. As the maintainer, I want the docs methodology notes updated to record how these pages were produced, so that the existing docs conventions stay consistent.

## Implementation Decisions

**`publish` job** (added to the spec 10 workflow):
- Runs only on `push` to `main`, on every one, with `needs` listing every CI job of the workflow. (Revised during ticket 38's reversal: it needed the `gate` job and ran only when the app image's inputs changed. Spec 10 has no `gate` and no path conditions any more. `main` only receives release PRs the maintainer merges and deploys stay manual, so an unchanged release just publishes an identical new `sha-*` image, which spec 11's lifecycle policy absorbs.)
- Permissions: `id-token: write` (OIDC) and `contents: read`.
- Assumes the ECR push role (spec 11) via GitHub OIDC, and pushes the already-built and already-scanned image from the build job's artifact rather than rebuilding it, so the published bytes are exactly the bytes that were tested.
- **Tags:** `sha-<short sha>` (immutable, the deployable reference) and `main` (moving). Plain ECR tag immutability forbids a moving tag. Use ECR's immutable-with-exclusions mode (exclusion filter for `main`) if the pinned AWS provider supports it. Otherwise drop the moving tag, so `sha-*` tags always stay immutable. Confirm against the provider when implementing.
- **Signing:** keyless cosign, using the workflow's OIDC identity. The signature is stored in ECR as an OCI 1.1 referrer of the image (not cosign's legacy `sha256-….sig` tag), so ECR's lifecycle rules protect it while the image exists and remove it afterwards (spec 11), and the transparency-log entry goes to the public Rekor log (acceptable, since the repo is public).
- **SBOM:** the CycloneDX SBOM from the build's `sbom` job is attached to the image as an OCI 1.1 referrer.
- The DB image's equivalent `publish-db` job lives in `db.yml` (spec 13).

**`deploy-app` workflow** (`workflow_dispatch`):
- **Input:** `app_sha` (required).
- **Environment:** `prod-app`, with the maintainer as required reviewer and deployment limited to `main`. It assumes the `deploy-app` OIDC role (spec 11), whose trust is limited to that environment.
- **Steps**, aborting on the first failure with a clear run-summary message:
  1. Confirm `sha-<app_sha>` exists in the `pensieve` repository, and `cosign verify` it against the expected `main` workflow identity and issuer.
  2. Register a new app task-definition revision with that image.
  3. Update the service to use it. On the first deploy, also set the desired count to 1, since Terraform creates the service at 0 (spec 11). Then wait until the service is stable.
- **Downtime:** the service's minimum-healthy 0% (spec 11) stops the old task before the new one starts. Downtime is about one Fargate cold start, during which Cloudflare serves its default origin-unavailable page.
- **Failure:** if the new task never becomes healthy (including a startup schema check refusal), ECS's circuit breaker rolls back to the previous revision. The workflow reports the failure and links the app log group.
- It never calls Terraform, never snapshots and never runs a migration.

**Deploy order and the coordinated window:**
- **Additive migration plus the app code using it:** dispatch `deploy-db` with `db_sha`, then `deploy-app` with `app_sha`.
- **Breaking migration:** dispatch only `deploy-db` with both `db_sha` and `app_sha`. It stops the app, snapshots, migrates and starts the new app revision in one window (spec 13).
- **App-only change:** `deploy-app`.
- **DB-only additive change:** `deploy-db`, which restarts the same app revision.

**Documentation** (VitePress docs site, following the existing conventions):
- An architecture page for the CI pipeline. It covers:
  - both workflows (`ci.yml` and `db.yml`), their jobs (each runs on every change) and the rulesets' per-job required checks
  - where findings go, and what's published from where
- An architecture page for the AWS deployment: the request path Cloudflare → Tunnel → `cloudflared` sidecar → app → RDS over IAM auth, plus the network layout, the app and DB images, roles and cost structure, with Mermaid diagrams.
- Operations runbooks:
  - **Bootstrap:**
    1. prerequisites, including creating the `prod-app` and `prod-db` GitHub Environments
    2. applying the bootstrap config, then applying prod
    3. the first release to `main`, which publishes both images
    4. running the local `db-bootstrap` script (spec 13)
    5. the first `deploy-db`, which creates the schema; the app is still at 0
    6. the first `deploy-app`
    7. the maintainer-only GitHub/Semgrep/CodeQL steps
  - **Deploy:**
    - which workflow to dispatch for each kind of change (above)
    - what each workflow does and the downtime to expect
    - how to mark a migration breaking, with spec 13's rule of thumb
    - failure handling for each workflow
    - rollback: after an app-only deploy, dispatch `deploy-app` with the previous SHA; after a breaking migration, restore the pre-deploy snapshot, then dispatch `deploy-app` with the previous SHA
  - **Restore:** point-in-time recovery, restoring a snapshot to a new instance, repointing the app, and when to use each. Restores run locally with the maintainer's SSO admin credentials; no GitHub role can restore. Only the newest pre-deploy snapshot is kept (spec 13); older states come from point-in-time recovery.
- The docs methodology notes gain entries for these pages. Per the existing convention, the architecture pages are kept in sync using the repository's own knowledge graph (graphify) where it applies, and by direct reading of the Terraform and workflow sources where the graph doesn't cover them. Record that limitation in the methodology notes, not in the pages themselves.

## Testing Decisions

- **Good tests here are real runs.** These are release and operations mechanics, not app logic, so there's no new unit-test seam in this spec.
- **Publishing** is verified by the first push to `main` after the release PR:
  - the image appears in ECR with its `sha-*` tag
  - `cosign verify`, using the expected GitHub OIDC identity and issuer, succeeds
  - the SBOM referrer is listed for the image
  - ECR lifecycle evaluation doesn't remove the signature or SBOM of kept images
  - a later release that touches no app inputs publishes no new app image
- **`deploy-app`** is verified by the first real deploy, following the bootstrap and deploy runbooks step by step. One deliberate deploy of an image with a tampered or missing signature should then fail at `cosign verify`.
- **Restore** is verified by one deliberate practice restore after the first deploy, following the restore runbook. Any discrepancy found becomes a runbook fix.
- **App-side safety nets** are already tested in spec 13 (the startup schema check) and spec 10 (the health endpoint, e2e against the image).
- **Docs pages** are verified by CI's `docs-build` job.

## Out of Scope

- Automatic deployment on publish. Both deploy workflows are dispatched by hand and approval-gated.
- Zero-downtime deploys and expand/contract migration discipline. Neither is needed with the maintenance-window approach (spec 13).
- A Cloudflare-hosted maintenance page during deploys.
- Release versioning (semver tags, changelogs, GitHub Releases).
- Image signature verification enforced by ECS. The deploy workflows verify instead.
- Restores from CI.
- A "panic button" for stopping compute when a budget is exceeded.
- Publishing the docs site (GitHub Pages or `docs.pensieve.fyi`).

## Further Notes

- **Branch flow:** feature work lands on `develop` by squash merge. Releases are PRs from `develop` into `main`, merged with a merge commit (the only method the `main` ruleset allows) so the two branches never diverge. A push to `main` is therefore what "release" means, and is what triggers `publish` and `publish-db`. Deploying a release is a separate, dispatched step.
- **Migration strategy alternatives considered and rejected** for the maintenance-window approach:
  - an init container in the task definition, which runs on every task start and races if more than one task runs
  - migrating on app startup, which has the same race and slows startup
  - running migrations from the CI runner, which can't reach the private RDS instance
  - The one-off task was chosen. It now runs the DB image from `deploy-db` (spec 13).
- **Revised after spec 13:**
  - The original design had a single local deploy script that migrated on every app release, plus a separate local migrate script, both run with SSO credentials, and no CD role.
  - Both were replaced by two dispatched, approval-gated workflows (`deploy-app` here, `deploy-db` in spec 13) with their own narrowly scoped OIDC roles (spec 11), so that the app and database release independently.
  - The master-secret bootstrap stays local.

This spec came out of the same `grill-me` session as specs 10 and 11, and was revised by the session that produced spec 13.
