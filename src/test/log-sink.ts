import { AsyncLocalStorage } from "node:async_hooks";
import { configure, getConfig, reset, type LogRecord } from "@logtape/logtape";

/**
 * Swaps in an in-memory array-backed sink for the duration of a test,
 * capturing every "pensieve"-category record. Call `restore()` to put the
 * previous global configuration back.
 */
export async function useTestLogSink(): Promise<{
  records: LogRecord[];
  restore: () => Promise<void>;
}> {
  const records: LogRecord[] = [];
  const previousConfig = getConfig();

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

  return {
    records,
    restore: async () => {
      if (previousConfig) {
        await configure(previousConfig);
      } else {
        await reset();
      }
    },
  };
}
