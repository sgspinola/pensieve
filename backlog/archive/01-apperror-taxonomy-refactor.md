# 01: AppError taxonomy refactor

**Status:** done

**Completed:** on `develop` (commit `a83d182` in `sgspinola/pensieve-archive`, prior to the feat-branch/PR workflow being adopted — no branch or PR exists for this ticket)

**What to build:** A single `AppError` base class in `src/services/errors.ts` that `UnauthorizedError`, `NotFoundError`, and `ValidationError` extend, so any not-happy-path error can be identified with one `instanceof` check. `ValidationError` additionally gains an optional field-level `issues` list.

**Blocked by:** None (can start immediately)

- [x] `AppError` base class added to `src/services/errors.ts`, with a machine-readable `code` derived from the subclass name (e.g. `NOT_FOUND`, `VALIDATION`) — no separate code registry
- [x] `UnauthorizedError` (401), `NotFoundError` (404), `ValidationError` (400) refactored to extend `AppError` without changing behavior at existing call sites
- [x] `ValidationError` accepts an optional `issues: { field: string, message: string }[]`, defaulting to an empty array for call sites that don't need it
- [x] Vitest coverage for each `AppError` subclass (status code, derived `code`, and `issues` where applicable)
