import { AsyncLocalStorage } from "node:async_hooks";
import { configure, reset, type LogRecord } from "@logtape/logtape";

/**
 * Swaps in an in-memory array-backed sink for the duration of a test,
 * capturing every "pensieve"-category record. Call `restore()` to reset
 * LogTape's configuration afterwards. It doesn't re-apply a configuration
 * that was there before (src/lib/logging.ts's, once something like
 * src/proxy.ts has loaded it): replacing that one closed its sinks, and
 * LogTape can't reopen a closed file sink.
 */
export async function useTestLogSink(): Promise<{
  records: LogRecord[];
  restore: () => Promise<void>;
}> {
  const records: LogRecord[] = [];

  await configure({
    contextLocalStorage: new AsyncLocalStorage(),
    sinks: {
      app: (record) => {
        records.push(record);
      },
    },
    loggers: [{ category: ["pensieve"], sinks: ["app"], lowestLevel: "debug" }],
    reset: true,
  });

  return { records, restore: () => reset() };
}
