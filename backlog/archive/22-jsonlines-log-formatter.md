# 22: Render structured log fields via a JSON Lines formatter

**What to build:** `logs/pensieve.log` (dev) and stdout (prod) currently show only `timestamp [LEVEL] category: message` — every structured field a call site already passes (`entityId`, `changedFields`, `route`, `method`, `status`, `userId`, `code`, `error`, `requestId`, etc.) is silently dropped because neither sink configures a `formatter`, so LogTape falls back to its default text formatter, which never reads `record.properties`. Configure both sinks to use LogTape's `getJsonLinesFormatter()` instead, so every field already being logged actually shows up.

**Blocked by:** None (can start immediately)

**Status:** done

**Completed:** on `feat/22-jsonlines-log-formatter`

**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/22

- [x] `buildSink()` in `src/lib/logging.ts` passes `formatter: getJsonLinesFormatter()` to both `getConsoleSink()` (prod) and `getRotatingFileSink()` (dev)
- [x] `docs/architecture/error-handling-logging.md`'s sink-configuration section/diagram updated to describe the JSON Lines format and why
- [x] Manually verified: a scripted `logMutationSuccess("Item created", { entityKind: "items", entityId: ... })` call now renders as a JSON line with `entityId` (and, once `requestId` is bound via `withContext`, `requestId` too) in `logs/pensieve.log`
