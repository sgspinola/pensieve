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

## Other scripts

```bash
npm run lint   # ESLint
npx tsc --noEmit   # typecheck
```
