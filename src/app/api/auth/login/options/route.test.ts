import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestLogSink } from "@/test/log-sink";

// Ticket 07: this route previously had no error handling at all. These
// tests cover the withErrorHandling wrap added here — both the success path
// (unchanged) and, since nothing else exercises the generic-500 path for an
// unauthenticated route, a genuinely unexpected throw from the service call.
const state = vi.hoisted(() => ({
  userHeader: undefined as string | undefined,
  cookieStore: new Map<string, string>(),
  generatePasskeyLoginOptions: vi.fn(),
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

vi.mock("@/services/auth/webauthn", () => ({
  generatePasskeyLoginOptions: () => state.generatePasskeyLoginOptions(),
}));

const { POST } = await import("./route");

describe("POST /api/auth/login/options — withErrorHandling (ticket 07)", () => {
  afterEach(() => {
    state.userHeader = undefined;
    state.cookieStore.clear();
    state.generatePasskeyLoginOptions.mockReset();
  });

  function postRequest(requestId?: string): Request {
    return new Request("http://localhost/api/auth/login/options", {
      method: "POST",
      headers: requestId ? { "x-request-id": requestId } : {},
    });
  }

  it("still returns the passkey options and sets the challenge cookie on success", async () => {
    state.generatePasskeyLoginOptions.mockResolvedValue({ challenge: "chal-123" });

    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "chal-123" });
    expect(state.cookieStore.get("webauthn_challenge")).toBe("chal-123");
  });

  it("maps an unexpected throw to the generic 500 envelope instead of crashing", async () => {
    state.generatePasskeyLoginOptions.mockRejectedValue(new Error("relying party config missing"));

    const response = await POST(postRequest("req-login-options-1"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "INTERNAL",
        message: "Something went wrong. Please try again.",
        requestId: "req-login-options-1",
      },
    });
  });

  it("logs one baseline line regardless of outcome", async () => {
    state.generatePasskeyLoginOptions.mockResolvedValue({ challenge: "chal-456" });
    const { records, restore } = await useTestLogSink();
    try {
      const response = await POST(postRequest("req-login-options-2"));
      expect(response.status).toBe(200);

      expect(records).toHaveLength(1);
      const [record] = records;
      expect(record.level).toBe("info");
      expect(record.properties).toMatchObject({
        method: "POST",
        status: 200,
        requestId: "req-login-options-2",
      });
      expect(record.properties.route).toContain("/api/auth/login/options");
      expect(typeof record.properties.durationMs).toBe("number");
      // Unauthenticated route — no session yet at this step of login.
      expect(record.properties.userId).toBeUndefined();
    } finally {
      await restore();
    }
  });
});
