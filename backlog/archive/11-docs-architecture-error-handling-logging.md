# 11: docs/architecture page for error-handling and logging design

**What to build:** A new page under `docs/architecture/` documenting the `AppError` taxonomy, the response envelope, the correlation-ID propagation mechanism, and the log pipeline (dev file / prod stdout / redaction) — so the design is discoverable without reading the implementation.

**Blocked by:** 05 (items routes rollout), 06 (flashcards routes rollout), 07 (auth/admin routes rollout), 08 (client error boundaries), 10 (mutation logging: remaining entities)

**Status:** done

**Completed:** on `feat/11-docs-architecture-error-handling-logging`

**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/20

- [x] New page under `docs/architecture/` covering: the `AppError` taxonomy and how `withErrorHandling` maps it, the `{ error: { code, message, requestId? } }` envelope, correlation-ID propagation via `AsyncLocalStorage`/LogTape context, and the log pipeline (dev file, prod stdout, redaction, mutation logging)
- [x] Built using this repo's own graphify graph (`graphify query`/`explain`/`path`), consistent with `CLAUDE.md`'s architecture-diagram convention
- [x] `docs/METHODOLOGY.md` updated with an entry noting this page was produced via graphify and where it fell short, if applicable
