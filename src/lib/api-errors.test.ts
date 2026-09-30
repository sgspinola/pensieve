import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { NextResponse } from "next/server";
import { encodeUserHeader } from "@/lib/auth-cookies";
import { getLogger } from "@/lib/logging";
import type { SessionUser } from "@/services/auth/session";
import { NotFoundError, UnauthorizedError, ValidationError } from "@/services/errors";
import { useTestLogSink } from "@/test/log-sink";

// withErrorHandling calls getCurrentUser() (@/lib/current-user), which reads
// the `x-pensieve-user` header via next/headers (set by src/proxy.ts in
// production) — mocked here the same way src/app/api/flashcards/route.test.ts
// mocks it, so tests can control whether a request is "authenticated"
// without a real session/DB.
const state = vi.hoisted(() => ({
  userHeader: undefined as string | undefined,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.userHeader ? { "x-pensieve-user": state.userHeader } : {}),
}));

const { withErrorHandling } = await import("./api-errors");

function makeRequest(requestId?: string): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: requestId ? { "x-request-id": requestId } : undefined,
  });
}

describe("withErrorHandling", () => {
  afterEach(() => {
    state.userHeader = undefined;
  });

  it("returns the handler's response unchanged on success", async () => {
    const handler = withErrorHandling(async () => NextResponse.json({ ok: true }, { status: 201 }));

    const response = await handler(makeRequest());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
  });

  it.each([
    ["UnauthorizedError", new UnauthorizedError("Nope"), 401, undefined] as const,
    ["NotFoundError", new NotFoundError("Missing"), 404, undefined] as const,
    [
      "ValidationError",
      new ValidationError("Bad input", [{ field: "x", message: "required" }]),
      400,
      [{ field: "x", message: "required" }],
    ] as const,
  ])(
    "maps a thrown %s to the { error: { code, message, requestId } } envelope",
    async (_name, err, status, issues) => {
      const handler = withErrorHandling(async () => {
        throw err;
      });

      const response = await handler(makeRequest("req-1"));

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        error: {
          code: err.code,
          message: err.message,
          requestId: "req-1",
          ...(issues ? { issues } : {}),
        },
      });
    },
  );

  it("omits issues from the envelope when a thrown ValidationError carries none", async () => {
    const handler = withErrorHandling(async () => {
      throw new ValidationError("Bad input");
    });

    const response = await handler(makeRequest("req-1"));
    const body = await response.json();

    expect(body.error.issues).toBeUndefined();
  });

  it("omits requestId from the envelope when the request doesn't carry one", async () => {
    const handler = withErrorHandling(async () => {
      throw new NotFoundError();
    });

    const response = await handler(makeRequest());
    const body = await response.json();

    expect(body.error.requestId).toBeUndefined();
  });

  it("collapses an unexpected throw to a generic, safe 500 with no internal detail leaked", async () => {
    // Assembled at runtime so secret scanners don't flag this dummy URL.
    const dummyConnectionString = ["postgres", "://user:pass@host/db"].join("");
    const handler = withErrorHandling(async () => {
      throw new Error(`db connection string leaked: ${dummyConnectionString}`);
    });

    const response = await handler(makeRequest("req-2"));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.requestId).toBe("req-2");
    expect(JSON.stringify(body)).not.toContain("postgres://");
    expect(JSON.stringify(body)).not.toContain("db connection string");
  });

  it("collapses a thrown non-Error value to the same generic 500", async () => {
    const handler = withErrorHandling(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "a raw string throw";
    });

    const response = await handler(makeRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("a raw string throw");
  });
});

describe("withErrorHandling baseline request logging", () => {
  afterEach(() => {
    state.userHeader = undefined;
  });

  it("logs one info line on success with route/method/status/duration/userId/requestId", async () => {
    const { records, restore } = await useTestLogSink();
    try {
      const user: SessionUser = { id: "user-1", displayName: "Alice", role: "member" };
      state.userHeader = encodeUserHeader(user);

      const handler = withErrorHandling(async () => NextResponse.json({ ok: true }, { status: 200 }));
      await handler(makeRequest("req-baseline"));

      expect(records).toHaveLength(1);
      const [record] = records;
      expect(record.level).toBe("info");
      expect(record.properties).toMatchObject({
        method: "POST",
        status: 200,
        userId: "user-1",
        requestId: "req-baseline",
      });
      expect(typeof record.properties.durationMs).toBe("number");
    } finally {
      await restore();
    }
  });

  it("logs with no userId when the request is unauthenticated", async () => {
    const { records, restore } = await useTestLogSink();
    try {
      const handler = withErrorHandling(async () => NextResponse.json({ ok: true }));
      await handler(makeRequest("req-anon"));

      expect(records).toHaveLength(1);
      expect(records[0].properties.userId).toBeUndefined();
    } finally {
      await restore();
    }
  });

  it("logs at warning for a thrown AppError, including its error code", async () => {
    const { records, restore } = await useTestLogSink();
    try {
      const handler = withErrorHandling(async () => {
        throw new ValidationError("Bad input");
      });
      await handler(makeRequest("req-warn"));

      expect(records).toHaveLength(1);
      expect(records[0].level).toBe("warning");
      expect(records[0].properties).toMatchObject({
        status: 400,
        code: "VALIDATION",
        requestId: "req-warn",
      });
    } finally {
      await restore();
    }
  });

  it("logs at error for an unexpected throw", async () => {
    const { records, restore } = await useTestLogSink();
    try {
      const handler = withErrorHandling(async () => {
        throw new Error("boom");
      });
      await handler(makeRequest("req-error"));

      expect(records).toHaveLength(1);
      expect(records[0].level).toBe("error");
      expect(records[0].properties.status).toBe(500);
      expect(records[0].properties.requestId).toBe("req-error");
    } finally {
      await restore();
    }
  });

  it("binds requestId into context so a nested log call (e.g. a service's mutation log) picks it up automatically", async () => {
    const { records, restore } = await useTestLogSink();
    try {
      const handler = withErrorHandling(async () => {
        // Simulates a service-layer mutation log (src/services/mutation-log.ts),
        // made from inside the handler rather than by withErrorHandling itself —
        // proving requestId reaches it via withContext, not by being passed explicitly.
        getLogger(["pensieve", "items"]).info("Item created", {
          entity: "items",
          entityId: "item-1",
        });
        return NextResponse.json({ ok: true });
      });

      await handler(makeRequest("req-nested"));

      const mutationRecord = records.find((r) => r.message.join("") === "Item created");
      expect(mutationRecord?.properties).toMatchObject({
        entity: "items",
        entityId: "item-1",
        requestId: "req-nested",
      });
    } finally {
      await restore();
    }
  });

  it("binds userId into context so a nested log call (e.g. a service's mutation log) picks it up automatically", async () => {
    const { records, restore } = await useTestLogSink();
    try {
      const user: SessionUser = { id: "user-2", displayName: "Bob", role: "member" };
      state.userHeader = encodeUserHeader(user);

      const handler = withErrorHandling(async () => {
        getLogger(["pensieve", "items"]).info("Item created", {
          entity: "items",
          entityId: "item-2",
        });
        return NextResponse.json({ ok: true });
      });

      await handler(makeRequest("req-nested-2"));

      const mutationRecord = records.find((r) => r.message.join("") === "Item created");
      expect(mutationRecord?.properties).toMatchObject({
        entity: "items",
        entityId: "item-2",
        userId: "user-2",
      });
    } finally {
      await restore();
    }
  });

  it("binds no userId for a nested log call when the request is unauthenticated", async () => {
    const { records, restore } = await useTestLogSink();
    try {
      const handler = withErrorHandling(async () => {
        getLogger(["pensieve", "items"]).info("Item created", {
          entity: "items",
          entityId: "item-3",
        });
        return NextResponse.json({ ok: true });
      });

      await handler(makeRequest("req-nested-3"));

      const mutationRecord = records.find((r) => r.message.join("") === "Item created");
      expect(mutationRecord?.properties.userId).toBeUndefined();
    } finally {
      await restore();
    }
  });
});
