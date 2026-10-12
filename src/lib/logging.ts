import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { configure, getConsoleSink, getJsonLinesFormatter, getLogger, withContext, type Sink } from "@logtape/logtape";
import { getRotatingFileSink } from "@logtape/file";
import { redactByField } from "@logtape/redaction";

const LOG_FILE_PATH = "logs/pensieve.log";

// Replaces (not merges with) @logtape/redaction's DEFAULT_REDACT_FIELDS, so
// every app-specific sensitive field must be listed explicitly here.
const REDACT_FIELDS = [
  /session.*token/i,
  /auth.*token/i,
  "token",
  /credential/i,
  /email/i,
  /recovery.*code/i,
];

// Both sinks otherwise fall back to LogTape's default text formatter, which
// renders only `timestamp [LEVEL] category: message` and never serializes
// `record.properties` — silently dropping every structured field a call
// site passes (entityId, requestId, etc.).
const formatter = getJsonLinesFormatter();

function buildSink(): Sink {
  if (process.env.NODE_ENV === "production") {
    return redactByField(getConsoleSink({ formatter }), REDACT_FIELDS);
  }

  // getRotatingFileSink doesn't create its parent directory itself.
  mkdirSync(dirname(LOG_FILE_PATH), { recursive: true });
  return redactByField(
    getRotatingFileSink(LOG_FILE_PATH, { maxSize: 1024 * 1024, maxFiles: 5, formatter }),
    REDACT_FIELDS,
  );
}

let configuredPromise: Promise<void> | undefined;

/**
 * Configures LogTape once per process. Safe to call from multiple entry
 * points; subsequent calls return the same (already-settled, once complete)
 * promise rather than reconfiguring.
 *
 * Callers that immediately depend on the configured state — e.g.
 * src/proxy.ts calling withContext() on the very first request a process
 * handles — must `await` this. configure() is itself async, so without
 * awaiting, a request landing before it resolves would see
 * `contextLocalStorage` still unset and withContext() would silently no-op
 * (logging a warning instead of binding the context), defeating request
 * correlation for exactly the requests most likely to need it (cold start).
 */
export function ensureLoggingConfigured(): Promise<void> {
  if (!configuredPromise) {
    configuredPromise = configure({
      contextLocalStorage: new AsyncLocalStorage(),
      sinks: { app: buildSink() },
      loggers: [{ category: ["pensieve"], sinks: ["app"], lowestLevel: "debug" }],
    }).then(() => {
      getLogger(["pensieve"]).info("Logging infrastructure configured", {
        env: process.env.NODE_ENV ?? "development",
      });
    });
  }
  return configuredPromise;
}

export { getLogger, withContext, REDACT_FIELDS };
