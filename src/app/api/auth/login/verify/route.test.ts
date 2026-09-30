import { afterEach, describe, expect, it, vi } from "vitest";

// Ticket 14: the request body's WebAuthn response envelope is now shape-
// validated (authenticationResponseSchema) before verifyPasskeyLogin is
// ever called — a malformed envelope is rejected as a clean 400 with
// issues, not handed to @simplewebauthn/server. Service call + cookies are
// mocked so this stays a route-level test, same pattern as
// src/app/api/auth/login/options/route.test.ts.
const state = vi.hoisted(() => ({
  cookieStore: new Map<string, string>(),
  verifyPasskeyLogin: vi.fn(),
  db: { marker: "fake-db" },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
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

vi.mock("@/services/auth/webauthn", () => ({
  verifyPasskeyLogin: (...args: unknown[]) => state.verifyPasskeyLogin(...args),
}));

const { POST } = await import("./route");

const validResponse = {
  id: "AQIDBA",
  rawId: "AQIDBA",
  response: {
    clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0",
    authenticatorData: "kZ7hI7BJmYXVWDF71-",
    signature: "MEUCIQ",
  },
  clientExtensionResults: {},
  type: "public-key",
};

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/login/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login/verify — response-body schema validation (ticket 14)", () => {
  afterEach(() => {
    state.cookieStore.clear();
    state.verifyPasskeyLogin.mockReset();
  });

  it("passes a structurally valid envelope through to verifyPasskeyLogin", async () => {
    state.cookieStore.set("webauthn_challenge", "chal-123");
    state.verifyPasskeyLogin.mockResolvedValue({
      user: { id: "u1", displayName: "Alice", role: "member" },
      session: { token: "tok", expiresAt: new Date() },
    });

    const response = await POST(postRequest({ response: validResponse }));

    expect(response.status).toBe(200);
    expect(state.verifyPasskeyLogin).toHaveBeenCalledWith(
      state.db,
      expect.objectContaining({ response: validResponse, expectedChallenge: "chal-123" }),
    );
  });

  it("rejects a body missing response.id with a 400 VALIDATION error, without calling verifyPasskeyLogin", async () => {
    state.cookieStore.set("webauthn_challenge", "chal-123");
    const { id: _id, ...rest } = validResponse;

    const response = await POST(postRequest({ response: rest }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION");
    expect(state.verifyPasskeyLogin).not.toHaveBeenCalled();
  });

  it("rejects a body missing response.rawId with a 400 VALIDATION error", async () => {
    state.cookieStore.set("webauthn_challenge", "chal-123");
    const { rawId: _rawId, ...rest } = validResponse;

    const response = await POST(postRequest({ response: rest }));

    expect(response.status).toBe(400);
    expect(state.verifyPasskeyLogin).not.toHaveBeenCalled();
  });

  it("rejects a wrong type literal with a 400 VALIDATION error", async () => {
    state.cookieStore.set("webauthn_challenge", "chal-123");

    const response = await POST(
      postRequest({ response: { ...validResponse, type: "not-public-key" } }),
    );

    expect(response.status).toBe(400);
    expect(state.verifyPasskeyLogin).not.toHaveBeenCalled();
  });

  it("rejects a missing nested response object with a 400 VALIDATION error", async () => {
    state.cookieStore.set("webauthn_challenge", "chal-123");

    const response = await POST(postRequest({}));

    expect(response.status).toBe(400);
    expect(state.verifyPasskeyLogin).not.toHaveBeenCalled();
  });
});
