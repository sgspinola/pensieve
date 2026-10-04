# 40: Database connection helper with RDS IAM auth

**What to build:** One shared connection helper that the app (and later the DB image's entrypoints) use to reach Postgres. When `DATABASE_URL` is set it behaves exactly as today, for local development and CI. Otherwise it builds the connection from host, port, database name and user environment variables, with a password function that signs a fresh 15-minute RDS IAM token per new connection using the task role's credentials, and TLS verified against the RDS CA bundle shipped in the image. Spec: `backlog/specs/11-aws-infrastructure.md` (user stories 32, 39, 40; "Application changes").

**Blocked by:** None (can start immediately)

**Status:** done

**Completed:** on `feat/40-iam-database-connection-helper`

**Pull Request:** https://github.com/sgspinola/pensieve/pull/27

- [x] With `DATABASE_URL` set, the helper yields URL-based config and behaviour is unchanged (existing tests and local dev keep working)
- [x] Without it, the helper yields host/port/database/user config whose password is an async function calling the injected RDS token signer on every invocation
- [x] IAM mode enables TLS with certificate verification against the bundled RDS CA bundle, and the bundle is copied into the app image
- [x] The app's database client uses the helper; no other module builds its own connection (the image's `migrate.cjs` uses it too; `src/test/db.ts`, which rewrites a superuser `DATABASE_URL` per throwaway test database, and `drizzle.config.ts` keep reading the URL directly, as documented there)
- [x] Pure Vitest unit tests cover both modes, with a test double for the signer (called once per invocation, never cached)
- [x] Docs updated under `docs/architecture/` if the database client's structure changes there

**Verification:** `src/db/connection.test.ts` covers both modes (6 tests). The built arm64 image was run against a real Postgres: `migrate.cjs` and `server.js` work unchanged with `DATABASE_URL`; in IAM mode `migrate.cjs` rejects a server with a self-signed certificate (TLS is verified against the bundled RDS CA); with neither configured it exits naming the missing variables. Signing against real RDS is first exercised by the prod deploy (tickets 48–54).
