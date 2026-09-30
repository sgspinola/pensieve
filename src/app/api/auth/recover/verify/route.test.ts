import { afterEach, describe, expect, it, vi } from "vitest";

// Ticket 14: body.response is now shape-validated (registrationResponseSchema
// — recovery installs a replacement passkey, so it's a registration
// ceremony) before completeAccountRecovery is called — a malformed envelope
// is rejected as a clean 400 with issues, not handed to
// @simplewebauthn/server.
const state = vi.hoisted(() => ({
  cookieStore: new Map<string, string>(),
  completeAccountRecovery: vi.fn(),
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
  completeAccountRecovery: (...args: unknown[]) => state.completeAccountRecovery(...args),
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
  return new Request("http://localhost/api/auth/recover/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seedCookies() {
  state.cookieStore.set("webauthn_challenge", "chal-123");
  state.cookieStore.set("webauthn_recovery_code", "recovery-code");
}

describe("POST /api/auth/recover/verify — response-body schema validation (ticket 14)", () => {
  afterEach(() => {
    state.cookieStore.clear();
    state.completeAccountRecovery.mockReset();
  });

  it("passes a structurally valid envelope through to completeAccountRecovery", async () => {
    seedCookies();
    state.completeAccountRecovery.mockResolvedValue({
      user: { id: "u1", displayName: "Alice", role: "member" },
      session: { token: "tok", expiresAt: new Date() },
    });

    const response = await POST(postRequest({ response: validResponse }));

    expect(response.status).toBe(200);
    expect(state.completeAccountRecovery).toHaveBeenCalledWith(
      state.db,
      expect.objectContaining({
        response: validResponse,
        expectedChallenge: "chal-123",
        code: "recovery-code",
      }),
    );
  });

  it("rejects a body missing response.id with a 400 VALIDATION error, without calling completeAccountRecovery", async () => {
    seedCookies();
    const { id: _id, ...rest } = validResponse;

    const response = await POST(postRequest({ response: rest }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION");
    expect(state.completeAccountRecovery).not.toHaveBeenCalled();
  });

  it("rejects a body missing response.rawId with a 400 VALIDATION error", async () => {
    seedCookies();
    const { rawId: _rawId, ...rest } = validResponse;

    const response = await POST(postRequest({ response: rest }));

    expect(response.status).toBe(400);
    expect(state.completeAccountRecovery).not.toHaveBeenCalled();
  });

  it("rejects a wrong type literal with a 400 VALIDATION error", async () => {
    seedCookies();

    const response = await POST(
      postRequest({ response: { ...validResponse, type: "not-public-key" } }),
    );

    expect(response.status).toBe(400);
    expect(state.completeAccountRecovery).not.toHaveBeenCalled();
  });

  it("rejects a missing nested response object with a 400 VALIDATION error", async () => {
    seedCookies();

    const response = await POST(postRequest({}));

    expect(response.status).toBe(400);
    expect(state.completeAccountRecovery).not.toHaveBeenCalled();
  });
});
