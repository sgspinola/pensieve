import { afterEach, describe, expect, it, vi } from "vitest";

// Ticket 14: body.response is now shape-validated (registrationResponseSchema)
// before registerPasskey is called — a malformed envelope is rejected as a
// clean 400 with issues, not handed to @simplewebauthn/server.
const state = vi.hoisted(() => ({
  cookieStore: new Map<string, string>(),
  registerPasskey: vi.fn(),
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
  registerPasskey: (...args: unknown[]) => state.registerPasskey(...args),
}));

const { POST } = await import("./route");

const validResponse = {
  id: "AQIDBA",
  rawId: "AQIDBA",
  response: {
    clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0",
    attestationObject: "o2NmbXRkbm9uZQ",
  },
  clientExtensionResults: {},
  type: "public-key",
};

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/register/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/register/verify — response-body schema validation (ticket 14)", () => {
  afterEach(() => {
    state.cookieStore.clear();
    state.registerPasskey.mockReset();
  });

  it("passes a structurally valid envelope through to registerPasskey", async () => {
    state.cookieStore.set("webauthn_challenge", "chal-123");
    state.registerPasskey.mockResolvedValue({
      user: { id: "u1", displayName: "Alice", role: "admin" },
      session: { token: "tok", expiresAt: new Date() },
      recoveryCodes: ["a", "b"],
    });

    const response = await POST(postRequest({ response: validResponse, displayName: "Alice" }));

    expect(response.status).toBe(200);
    expect(state.registerPasskey).toHaveBeenCalledWith(
      state.db,
      expect.objectContaining({
        response: validResponse,
        expectedChallenge: "chal-123",
        displayName: "Alice",
      }),
    );
  });

  it("rejects a body missing response.id with a 400 VALIDATION error, without calling registerPasskey", async () => {
    state.cookieStore.set("webauthn_challenge", "chal-123");
    const { id: _id, ...rest } = validResponse;

    const response = await POST(postRequest({ response: rest, displayName: "Alice" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION");
    expect(state.registerPasskey).not.toHaveBeenCalled();
  });

  it("rejects a body missing response.rawId with a 400 VALIDATION error", async () => {
    state.cookieStore.set("webauthn_challenge", "chal-123");
    const { rawId: _rawId, ...rest } = validResponse;

    const response = await POST(postRequest({ response: rest, displayName: "Alice" }));

    expect(response.status).toBe(400);
    expect(state.registerPasskey).not.toHaveBeenCalled();
  });

  it("rejects a wrong type literal with a 400 VALIDATION error", async () => {
    state.cookieStore.set("webauthn_challenge", "chal-123");

    const response = await POST(
      postRequest({ response: { ...validResponse, type: "not-public-key" }, displayName: "Alice" }),
    );

    expect(response.status).toBe(400);
    expect(state.registerPasskey).not.toHaveBeenCalled();
  });

  it("rejects a missing nested response object with a 400 VALIDATION error", async () => {
    state.cookieStore.set("webauthn_challenge", "chal-123");

    const response = await POST(postRequest({ displayName: "Alice" }));

    expect(response.status).toBe(400);
    expect(state.registerPasskey).not.toHaveBeenCalled();
  });
});
