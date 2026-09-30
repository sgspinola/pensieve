# 02: LogTape logging infrastructure setup

**Status:** done

**Completed:** on `02-logtape-logging-infrastructure-setup`

**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/2

**What to build:** Install LogTape and configure it once per process with `AsyncLocalStorage`-backed implicit context, an environment-driven sink (a local rotating file in development, console/stdout in production) wrapped in field redaction, plus a reusable in-memory test sink so later tickets' Vitest suites can assert on captured log records.

**Blocked by:** None (can start immediately)

**Read this first:**

- `package.json` (read directly): no logging library exists today; runtime deps are `drizzle-orm`/`next`/`react`/etc. New logging packages go under `"dependencies"`.
- No `console.*` calls exist anywhere under `src/` (`grep -rn "console\." src` returns zero matches). The only `console.*` usage in the repo is in one-off CLI scripts (`scripts/backfill-flashcard-source-and-hash.ts`, `scripts/backfill-item-titles.ts`, `scripts/import-flashcards.ts`) — those are standalone maintenance scripts outside the request lifecycle this spec covers; leave them alone.
- `.gitignore` (read directly) has no entry for a log file/directory yet — this ticket must add one.
- `next.config.ts` (read directly) is the default empty config — no existing instrumentation hook.
- Verified live against LogTape's own docs (`https://logtape.org/manual/start`, `/manual/contexts`, `/manual/sinks`, `/sinks/file`, `/manual/redaction`, `/manual/levels`, `/sinks/cloudwatch-logs`) rather than relying on memory, since this is a brand-new dependency for this repo:
  - The core npm package is **`@logtape/logtape`** (not bare `logtape`).
  - `configure({ contextLocalStorage: new AsyncLocalStorage() })` (imported from `"node:async_hooks"`) enables implicit context. `withContext(context, callback)` binds fields for the duration of `callback`; any nested `getLogger([...]).info(...)` call made anywhere inside that callback's call stack automatically includes the bound fields — no parameter threading.
  - Logger instance methods are `logger.trace/debug/info/warning/error/fatal` — the canonical level name is **`warning`**, not `warn` (a `.warn()` shorthand alias exists since LogTape 2.0, but `configure()`'s own level-string config uses `"warning"`).
  - The console sink is `getConsoleSink()`, exported from `@logtape/logtape` itself.
  - The rotating file sink is **not** in the core package — it's `getRotatingFileSink(filename, options)` from a separate package, **`@logtape/file`**, with `maxSize`/`maxFiles` options.
  - `@logtape/redaction` exports `redactByField(sink, patterns)` — wraps a sink, stripping (or replacing) any field whose name matches a given array of strings/regexes. Passing your own `patterns` array **replaces** the built-in `DEFAULT_REDACT_FIELDS` default, it doesn't merge with it — so the patterns list in this ticket must explicitly cover everything the spec asks for (session/auth tokens, WebAuthn credential fields, email addresses, recovery codes), not rely on the library's defaults to catch app-specific field names.
  - `@logtape/cloudwatch-logs` exports `getCloudWatchLogsSink({ logGroup, logStream, region, batchSize, flushInterval, retries })`, defaulting to `batchSize: 1000` / `flushInterval: 1000` (ms) — matches the spec's "batched, default 1000 events/1s flush" description. This ticket installs it but does **not** wire it with real config (see Out of scope).

**Implementation approach:**

1. `npm install @logtape/logtape @logtape/file @logtape/redaction @logtape/cloudwatch-logs` (the last one is installed and importable, not invoked yet — see Out of scope).
2. Create `src/lib/logging.ts`:
   ```ts
   import { AsyncLocalStorage } from "node:async_hooks";
   import { configure, getConsoleSink, getLogger, withContext, type Sink } from "@logtape/logtape";
   import { getRotatingFileSink } from "@logtape/file";
   import { redactByField } from "@logtape/redaction";

   const REDACT_FIELDS = [
     /session.*token/i,
     /auth.*token/i,
     "token",
     /credential/i,
     /email/i,
     /recovery.*code/i,
   ];

   function buildSink(): Sink {
     const base: Sink =
       process.env.NODE_ENV === "production"
         ? getConsoleSink()
         : getRotatingFileSink("logs/pensieve.log", { maxSize: 1024 * 1024, maxFiles: 5 });
     return redactByField(base, REDACT_FIELDS);
   }

   let configured = false;

   export function ensureLoggingConfigured(): void {
     if (configured) return;
     configured = true;
     configure({
       contextLocalStorage: new AsyncLocalStorage(),
       sinks: { app: buildSink() },
       loggers: [{ category: ["pensieve"], sinks: ["app"], lowestLevel: "debug" }],
     });
     getLogger(["pensieve"]).info("Logging configured", { env: process.env.NODE_ENV ?? "development" });
   }

   export { getLogger, withContext };
   ```
   Double-check the `configure()` options object's exact key for wiring a category to sinks (`loggers` above) against the installed package's own `.d.ts` once it's actually installed — LogTape's docs snippets fetched for this ticket may lag the exact published version; if `loggers` doesn't type-check, the editor/`tsc` error will show the correct key name (e.g. it may be `categories` in the installed version).

   Note from implementation: `loggers` was correct against the installed `2.3.9` types. Two issues in this sketch needed fixing against the real package, though: `configure()` is genuinely `async` (it awaits an internal global-config mutation), so calling it without awaiting and then immediately logging the startup line risks the log firing before the sink is registered — the real `src/lib/logging.ts` chains the startup log off `configure(...).then(...)` instead. Also `getRotatingFileSink` does not create its target directory, so `buildSink()` calls `mkdirSync(dirname(...), { recursive: true })` before creating the dev sink, otherwise the first `ensureLoggingConfigured()` call throws `ENOENT`.
3. Call `ensureLoggingConfigured()` once, from module scope in `src/proxy.ts` (a top-level side-effecting call, e.g. `ensureLoggingConfigured();` right after the imports) — every request already passes through `proxy()`, and the function only runs once per process regardless of how many requests arrive, guarded by the `configured` flag above.
4. Add a `/logs/` entry to `.gitignore`, alongside the existing `# next.js` section.
5. Add `src/test/log-sink.ts`: a helper that swaps in an in-memory array-backed sink via `configure()` for the duration of a test and returns both the captured array and a restore function, e.g.:
   ```ts
   import { configure, type LogRecord } from "@logtape/logtape";

   export async function useTestLogSink(): Promise<{ records: LogRecord[]; restore: () => void }> {
     const records: LogRecord[] = [];
     await configure({
       sinks: { app: (record) => records.push(record) },
       loggers: [{ category: ["pensieve"], sinks: ["app"], lowestLevel: "debug" }],
       reset: true,
     });
     return { records, restore: () => {} };
   }
   ```
   Confirm `configure()`'s exact "allow re-configuring / reset" option (the sketch above assumes a `reset: true`-style flag exists so a test can override the process-wide config `ensureLoggingConfigured()` already set) against the installed package's types — this is the one piece of this ticket most likely to need adjustment once the real package is in `node_modules`.

   Note from implementation: `reset: true` is correct against `2.3.9`. The real `useTestLogSink()` also passes its own `contextLocalStorage` (otherwise `withContext` silently no-ops inside a test, since resetting the global config drops whatever `contextLocalStorage` `ensureLoggingConfigured()` originally set), and implements a real `restore()` by snapshotting `getConfig()` beforehand and replaying it (or falling back to `reset()`).
6. Add `src/lib/logging.test.ts` asserting: a record containing `email`/`token`/etc. fields, passed through `buildSink()`'s composed (redacting) sink into `useTestLogSink()`, has those fields stripped from what's captured; and that `withContext({ requestId: "abc" }, () => getLogger(["pensieve"]).info("test"))` produces a captured record whose bound context includes `requestId: "abc"`.

   Note from implementation: `LogRecord` (installed `2.3.9` types) has no `context` field — bound `withContext` fields and per-call fields are merged into `properties`, and `redactByField`'s default action is to delete a matching key outright (not replace it with a placeholder string), and it matches on exact field name (string patterns) or `regex.test(fieldName)` (not the value). The redaction test therefore builds its own `redactByField(sink, REDACT_FIELDS)`-wrapped sink directly (re-exporting `REDACT_FIELDS` from `src/lib/logging.ts`) rather than using the plain, unwrapped capture sink from `useTestLogSink()`, and asserts the sensitive keys are absent from `record.properties` rather than replaced.

**Out of scope:** don't wire `@logtape/cloudwatch-logs`'s sink into `buildSink()` with real AWS config — install and leave it unconfigured/unused, per the spec's explicit deferral (no AWS deployment target exists in this repo yet).

- [x] `@logtape/logtape`, `@logtape/file`, `@logtape/redaction`, `@logtape/cloudwatch-logs` added to `dependencies`
- [x] `src/lib/logging.ts` configures LogTape once per process with `AsyncLocalStorage`-backed context, a dev rotating-file sink, a prod console sink, both wrapped in `redactByField` covering session/auth tokens, WebAuthn credential fields, email addresses, and recovery codes
- [x] `.gitignore` has an entry for the new local log file/directory
- [x] `src/test/log-sink.ts` provides a reusable in-memory sink for Vitest assertions on log records
- [x] `src/lib/logging.test.ts` covers redaction and context-propagation behavior

**How to verify:** `npm test -- logging.test.ts` (Vitest, no DB). Manually: `npm run dev`, confirm a `logs/pensieve.log` file appears containing the "Logging configured" startup line from step 2.
