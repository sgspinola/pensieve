# 40: Database connection helper with RDS IAM auth

**What to build:** One shared connection helper that the app (and later the DB image's entrypoints) use to reach Postgres. When `DATABASE_URL` is set it behaves exactly as today, for local development and CI. Otherwise it builds the connection from host, port, database name and user environment variables, with a password function that signs a fresh 15-minute RDS IAM token per new connection using the task role's credentials, and TLS verified against the RDS CA bundle shipped in the image. Spec: `backlog/specs/11-aws-infrastructure.md` (user stories 32, 39, 40; "Application changes").

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] With `DATABASE_URL` set, the helper yields URL-based config and behaviour is unchanged (existing tests and local dev keep working)
- [ ] Without it, the helper yields host/port/database/user config whose password is an async function calling the injected RDS token signer on every invocation
- [ ] IAM mode enables TLS with certificate verification against the bundled RDS CA bundle, and the bundle is copied into the app image
- [ ] The app's database client uses the helper; no other module builds its own connection
- [ ] Pure Vitest unit tests cover both modes, with a test double for the signer (called once per invocation, never cached)
- [ ] Docs updated under `docs/architecture/` if the database client's structure changes there
