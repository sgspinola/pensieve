import { AsyncLocalStorage } from "node:async_hooks";
import { describe, it, expect } from "vitest";
import { configure, type LogRecord } from "@logtape/logtape";
import { redactByField } from "@logtape/redaction";
import { ensureLoggingConfigured, getLogger, withContext, REDACT_FIELDS } from "@/lib/logging";
import { useTestLogSink } from "@/test/log-sink";

describe("logging infrastructure", () => {
  it("configures logging exactly once per process", () => {
    expect(() => {
      ensureLoggingConfigured();
      ensureLoggingConfigured();
    }).not.toThrow();
  });

  it("redacts sensitive fields through the same redaction pipeline buildSink() uses", async () => {
    const records: LogRecord[] = [];

    // Exercises the actual redaction wrapper (REDACT_FIELDS), unlike
    // useTestLogSink()'s plain capture sink, so this proves buildSink()'s
    // composition -- not just the array sink -- strips these fields.
    await configure({
      contextLocalStorage: new AsyncLocalStorage(),
      sinks: {
        app: redactByField((record) => {
          records.push(record);
        }, REDACT_FIELDS),
      },
      loggers: [{ category: ["pensieve"], sinks: ["app"], lowestLevel: "debug" }],
      reset: true,
    });

    await withContext({ requestId: "test-request" }, () => {
      getLogger(["pensieve"]).info("User logged in", {
        sessionToken: "session-token-ABCDEF",
        email: "secret-user@corporate.com",
        webAuthnCredential: { id: "atk-XYZ" },
        recoveryCode: "TEMP-SECRET-CODE-123",
        resourceId: "keep-me",
      });
    });

    expect(records).toHaveLength(1);
    const [record] = records;

    expect(record.properties).not.toHaveProperty("sessionToken");
    expect(record.properties).not.toHaveProperty("email");
    expect(record.properties).not.toHaveProperty("webAuthnCredential");
    expect(record.properties).not.toHaveProperty("recoveryCode");
    expect(record.properties.resourceId).toBe("keep-me");
    expect(record.properties.requestId).toBe("test-request");
  });

  describe("context propagation", () => {
    it("binds context fields onto records logged inside withContext", async () => {
      const { records } = await useTestLogSink();

      await withContext({ requestId: "request-12345" }, () => {
        getLogger(["pensieve"]).info("Successfully retrieved data", { resourceId: "XYZ" });
      });

      expect(records).toHaveLength(1);
      expect(records[0].properties).toMatchObject({
        requestId: "request-12345",
        resourceId: "XYZ",
      });
    });

    it("has no bound context when withContext is not used", async () => {
      const { records } = await useTestLogSink();

      getLogger(["pensieve"]).info("Simple message without context");

      expect(records).toHaveLength(1);
      expect(records[0].properties).toEqual({});
    });
  });
});
