import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestLogSink } from "@/test/log-sink";

// Pilot route for ticket 04's withErrorHandling wrapper (see
// src/lib/api-errors.ts). This route calls getCurrentUser() (via the
// wrapper, for the baseline log's userId) and, deeper in, cookies() — both
// read from next/headers, mocked the same way
// src/app/api/flashcards/route.test.ts mocks it. This particular request
// (an empty body) never reaches the cookies()/DB-touching part of the route
// (see parseOrThrow(recoverOptionsBodySchema, body) in route.ts, added by
// ticket 16), so only `headers` needs mocking here.
const state = vi.hoisted(() => ({
  userHeader: undefined as string | undefined,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.userHeader ? { "x-pensieve-user": state.userHeader } : {}),
}));

const { POST } = await import("./route");

describe("POST /api/auth/recover/options — withErrorHandling pilot (ticket 04) + Zod body validation (ticket 16)", () => {
  afterEach(() => {
    state.userHeader = undefined;
  });

  function postRequest(body: unknown, requestId?: string): Request {
    return new Request("http://localhost/api/auth/recover/options", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it("returns a 400 with a VALIDATION code for a missing code, through the wrapper (ticket 16)", async () => {
    const response = await POST(postRequest({}));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
  });

  it("logs one baseline line at warning: route/method, status, code, duration, user ID, request ID", async () => {
    const { records, restore } = await useTestLogSink();
    try {
      const response = await POST(postRequest({}, "req-pilot-1"));
      expect(response.status).toBe(400);

      expect(records).toHaveLength(1);
      const [record] = records;
      // A thrown ValidationError (ticket 16) is an AppError, so
      // withErrorHandling logs it at "warning", not "info" — see
      // src/lib/api-errors.test.ts for the generic case.
      expect(record.level).toBe("warning");
      expect(record.properties).toMatchObject({
        method: "POST",
        status: 400,
        code: "VALIDATION",
        requestId: "req-pilot-1",
      });
      expect(record.properties.route).toContain("/api/auth/recover/options");
      expect(typeof record.properties.durationMs).toBe("number");
      // Unauthenticated route — no session yet at this step of recovery.
      expect(record.properties.userId).toBeUndefined();
    } finally {
      await restore();
    }
  });
});
