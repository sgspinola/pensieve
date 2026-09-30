import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestLogSink } from "@/test/log-sink";

// Ticket 07: this route previously had no error handling at all. These
// tests cover the withErrorHandling wrap added here — the no-session and
// active-session success paths (unchanged), plus the generic-500 path for
// an unexpected throw out of deleteSession.
const state = vi.hoisted(() => ({
  userHeader: undefined as string | undefined,
  cookieStore: new Map<string, string>(),
  db: {} as unknown,
  deleteSession: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.userHeader ? { "x-pensieve-user": state.userHeader } : {}),
  cookies: async () => ({
    get: (name: string) => (state.cookieStore.has(name) ? { name, value: state.cookieStore.get(name)! } : undefined),
    set: (name: string, value: string) => {
      state.cookieStore.set(name, value);
    },
    delete: (name: string) => {
      state.cookieStore.delete(name);
    },
  }),
}));

vi.mock("@/db/client", () => ({
  getDb: () => state.db,
}));

vi.mock("@/services/auth/session", () => ({
  deleteSession: (...args: unknown[]) => state.deleteSession(...args),
}));

const { POST } = await import("./route");

describe("POST /api/auth/logout — withErrorHandling (ticket 07)", () => {
  afterEach(() => {
    state.userHeader = undefined;
    state.cookieStore.clear();
    state.deleteSession.mockReset();
  });

  function postRequest(requestId?: string): Request {
    return new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: requestId ? { "x-request-id": requestId } : {},
    });
  }

  it("returns ok without deleting a session when there is no session cookie", async () => {
    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(state.deleteSession).not.toHaveBeenCalled();
  });

  it("deletes the session and clears the cookie when one is present", async () => {
    state.cookieStore.set("session", "session-token-123");
    state.deleteSession.mockResolvedValue(undefined);

    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(state.deleteSession).toHaveBeenCalledWith(state.db, "session-token-123");
    expect(state.cookieStore.has("session")).toBe(false);
  });

  it("maps an unexpected throw to the generic 500 envelope instead of crashing", async () => {
    state.cookieStore.set("session", "session-token-456");
    state.deleteSession.mockRejectedValue(new Error("DB connection lost"));

    const response = await POST(postRequest("req-logout-1"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "INTERNAL",
        message: "Something went wrong. Please try again.",
        requestId: "req-logout-1",
      },
    });
  });

  it("logs one baseline line regardless of outcome", async () => {
    const { records, restore } = await useTestLogSink();
    try {
      const response = await POST(postRequest("req-logout-2"));
      expect(response.status).toBe(200);

      expect(records).toHaveLength(1);
      const [record] = records;
      expect(record.level).toBe("info");
      expect(record.properties).toMatchObject({
        method: "POST",
        status: 200,
        requestId: "req-logout-2",
      });
      expect(record.properties.route).toContain("/api/auth/logout");
      expect(typeof record.properties.durationMs).toBe("number");
      // No x-pensieve-user header set on this request — the wrapper's
      // best-effort currentUserId() falls back to undefined.
      expect(record.properties.userId).toBeUndefined();
    } finally {
      await restore();
    }
  });
});
