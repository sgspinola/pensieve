# Pensieve

Private, multi-user knowledge base for saved links, tools, and self-authored
wiki articles. See `specs/pensieve-v1.md` for the full product spec.

## Stack

- Next.js + TypeScript (App Router). Business logic lives in framework-agnostic
  service functions under `src/services/`, not in route handlers.
- Postgres via [Drizzle ORM](https://orm.drizzle.team/) (`src/db/`).
- Vitest for tests, run against a real, disposable Postgres schema per test run
  (`src/test/db.ts`) — no mocked database.

## Local setup

Requires Node 24 (pinned in `.nvmrc`, so `nvm use` picks it up) and npm
11.16.0, as declared in `package.json`'s `engines` — the same versions CI
uses, so installs resolve identically and honour the `allowScripts`
install-script allowlist.

1. Start Postgres:

   ```bash
   docker compose up -d --wait
   ```

   (`--wait` blocks until Postgres's healthcheck passes, so the next step
   doesn't race a still-starting container.)

2. Copy the env file and install dependencies:

   ```bash
   cp .env.example .env
   npm install
   ```

3. Apply migrations to your dev database:

   ```bash
   npm run db:migrate
   ```

4. Run the app:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Running tests

```bash
npm test
```

Each test run gets its own throwaway Postgres database: `src/test/db.ts`
creates a uniquely-named database, runs all migrations into it, hands the
test a scoped Drizzle client, and drops the database again on teardown (a
full database per run, rather than a schema within one shared database, is
necessary because drizzle-kit hardcodes the `public` schema in generated
foreign key references). Tests call real service functions against this real
database — nothing is mocked.

`src/services/ping.test.ts` is a minimal example demonstrating the harness
end-to-end (create a throwaway row, read it back via a real query, tear
down); it's a template for how future service-layer tests should be
structured, not a real feature.

## Authentication

The entire app sits behind passkey (WebAuthn) authentication — there is no
unauthenticated page, including the landing page. On a fresh deployment (an
empty `users` table), the first passkey registration becomes the sole admin
account; a global auth gate (`src/proxy.ts`, Next's server-side request
interceptor) then requires a valid session for every other page and API
route.

For local development the WebAuthn relying party defaults to `localhost` /
`http://localhost:3000`, so no extra env vars are needed. Before deploying to
a real domain, set `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, and `WEBAUTHN_ORIGIN`
(see `.env.example`) — the RP ID is bound to the domain permanently, since
changing it later invalidates every existing passkey.

Service-layer tests for the auth ceremonies (`src/services/auth/`) use
`src/test/virtualAuthenticator.ts`, a software stand-in for a real WebAuthn
authenticator that produces cryptographically valid registration/
authentication responses — nothing about the server-side verification path
is mocked.

### Account recovery

Registering a passkey issues ten one-time recovery codes, shown once
(`generateRecoveryCodes`) — only their SHA-256 hashes are ever stored. A lost
passkey is recovered by redeeming a saved code (`redeemRecoveryCode`), which
atomically marks it used and identifies the account, then completing a
WebAuthn registration ceremony to attach a replacement passkey to that same
account ("Lost your passkey?" on the login page, `/api/auth/recover/*`).

## Database changes

After editing `src/db/schema.ts`:

```bash
npm run db:generate   # generates a new migration from the schema diff
npm run db:migrate    # applies pending migrations to the dev database
```

## Production image

The deployable artifacts are two arm64 container images on distroless Node
(no shell, runs as non-root): the app image, built from Next's standalone
output by the root `Dockerfile`, and the DB image, which holds the migrations
and their migrator, built by `db/Dockerfile`. See
[Deployable image](docs/architecture/deployable-image.md) for what's inside.
`.dockerignore` keeps `.env*` out of the build, so a local `.env` never ends
up in the image.

```bash
# Build the app image and the DB image (both from the repo root)
docker build --platform linux/arm64 -t pensieve .
docker build --platform linux/arm64 -f db/Dockerfile -t pensieve-db .

# A network the app, migrations and Postgres share (any reachable Postgres works)
docker network create pensieve-net
docker run -d --name pensieve-db --network pensieve-net -p 5433:5432 \
  -e POSTGRES_USER=pensieve -e POSTGRES_PASSWORD=pensieve -e POSTGRES_DB=pensieve \
  postgres:17-alpine

# Throwaway local credentials, passed through to both containers below
export DATABASE_URL=postgres://pensieve:pensieve@pensieve-db:5432/pensieve # trufflehog:ignore

# Migrate: the DB image's default command (drizzle-orm's migrator); exits
# non-zero on failure. `npm run db:migrate` against the same database works too.
docker run --rm --network pensieve-net -e DATABASE_URL pensieve-db

# Run: its HEALTHCHECK polls /api/health (`docker ps` shows healthy/unhealthy)
docker run -d --name pensieve-app --network pensieve-net -p 3200:3000 \
  -e DATABASE_URL pensieve
```

To run the e2e suite against the running image instead of `next dev`, set
`PLAYWRIGHT_BASE_URL` (which skips Playwright's `webServer`) and point
`DATABASE_URL` at the same database from the host, since global setup seeds
its session user directly:

```bash
PLAYWRIGHT_BASE_URL=http://localhost:3200 \
DATABASE_URL=postgres://pensieve:pensieve@localhost:5433/pensieve \
npm run test:e2e
```

## CI

`.github/workflows/ci.yml` runs on every pull request into `develop`/`main`
and every push to them: lint (ESLint, actionlint and hadolint), typecheck,
unit (Vitest against a `postgres:17-alpine` service container), docs-build,
trufflehog, semgrep, sbom, build (the arm64 image, secret-scanned before
upload), trivy (the built image's vulnerability scan) and e2e (the Playwright
suite against that built image, migrated with `npm run db:migrate`).
`.github/workflows/db.yml` runs on the same branches, but only when a
database source changes (`drizzle/`, `db/`, `src/db/`, `certs/`,
`drizzle.config.ts`, `.dockerignore` or the workflow): db-image (builds the
DB image and runs Trivy's secret and vulnerability scans on it) and db-apply
(the image's migrator applies every migration to an empty
`postgres:17-alpine`). See
[Deployable image](docs/architecture/deployable-image.md#building-in-ci) and
[Testing the app image](docs/architecture/deployable-image.md#testing-the-app-image).
The branch rulesets require each `ci.yml` gate by its job name. Adding or
renaming one means updating the `develop` and `main` rulesets' required
checks too. `db.yml`'s jobs aren't required, since a required check whose
workflow didn't trigger would block every app-only PR.
On PRs into `main`, `release-source` also fails unless the head branch is
`develop`.

### Secret scanning

The `trufflehog` job runs [TruffleHog](https://github.com/trufflesecurity/trufflehog)
over just the commits under test (a PR's new commits, or a push's
before..after range) and fails on verified, unknown and unverified findings
alike. Results also go to GitHub Code Scanning. Older history was scanned when
it landed, and GitHub secret scanning keeps covering it.

A known-harmless finding (e.g. a throwaway local URL or a test fixture) gets a
`trufflehog:ignore` comment on the same line, saying why. Never ignore a real
credential: rotate it (see below).

A local pre-commit hook runs the same scan over your staged changes, so most
leaks never reach GitHub. Set it up once per clone:

```bash
brew install trufflehog lefthook
lefthook install   # writes .git/hooks/pre-commit from lefthook.yml
```

### If a secret is found

The repository is public, so a leaked credential must be treated as
compromised even if the commit or image is removed:

1. **Rotate the credential.** Deleting it from the branch, history or image
   isn't enough.
2. **Delete affected Actions artifacts and caches** that may contain it
   (artifact deletion / `gh run delete`, `gh cache delete`).
3. **Treat the affected workflow run logs as exposed.**

### SAST, SCA and SBOM

`semgrep` runs `semgrep ci`, authenticated with the `SEMGREP_APP_TOKEN`
repository secret, so what blocks a merge is set by the Code and Supply Chain
policies in the Semgrep dashboard, not in the workflow. Fork and Dependabot
PRs don't get repository secrets, so they fall back to `semgrep scan` with
`p/default`, `p/typescript`, `p/react`, `p/nextjs` and `p/owasp-top-ten`,
failing on any finding. Both paths report to GitHub Code Scanning. To run the
fallback locally:

```bash
semgrep scan --error --config p/default --config p/typescript \
  --config p/react --config p/nextjs --config p/owasp-top-ten
```

`sbom` records the production dependencies (what ships in the image) as a
CycloneDX SBOM, kept as a workflow artifact for 90 days
(`npm sbom --sbom-format cyclonedx --omit dev`).

`.npmrc` sets `min-release-age=7`, so `npm install` only resolves versions
published at least a week ago (`npm ci` installs the lockfile as-is), and
Dependabot waits the same 7 days before proposing a version update.

### Image vulnerability scan

`trivy` scans the image `build` produced for known vulnerabilities in its
Debian packages and its bundled npm packages, failing on any severity that has
a fix available. Unfixable findings don't block. To ship a fixable one anyway,
add its ID to `.trivyignore` with a comment giving the reason and an
`exp:YYYY-MM-DD` expiry; once that date passes, the finding fails the scan
again. Trivy doesn't detect the Node binary in the distroless base, so Node
itself is kept current by Dependabot's weekly base-image digest bumps.

## Other scripts

```bash
npm run lint   # ESLint
npm run typecheck   # next typegen + tsc --noEmit
```
