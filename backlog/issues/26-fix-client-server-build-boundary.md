# 26: Fix the client/server import boundary so `next build` passes

**What to build:** `next build` currently fails with a Turbopack internal error (`node:async_hooks` cannot be bundled for the browser): a client component on the flashcards page imports the delete-permission predicate from the flashcards service module, which transitively pulls in the LogTape logging and mutation-log stack. Move that predicate into a new pure, I/O-free flashcards permissions module (following the existing flashcards pagination and tag-validation modules that client components already import safely), have the service re-export it so server callers are unaffected, and mark the logging, mutation-log and database client modules with the `server-only` package so any future client-side import fails the build with an explicit message instead of an opaque bundler error. Spec: `backlog/specs/10-ci-pipeline.md` (user stories 5–7).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Delete-permission predicate lives in a pure flashcards permissions module with no server imports; the flashcards client component imports it from there
- [ ] Flashcards service re-exports the predicate; existing server-side callers compile unchanged
- [ ] The predicate's existing unit tests move alongside the new module, unchanged, and pass
- [ ] Logging, mutation-log and database client modules import `server-only`
- [ ] `next build` succeeds locally
- [ ] Verified whether `next build` needs a reachable database; if any route queries the DB during static generation, it is marked dynamic so the build runs with no DB access
- [ ] Manually confirmed: temporarily re-importing a server-only module from a client component fails `next build` with the `server-only` error message
- [ ] `npm test` and `npm run test:e2e` still pass
