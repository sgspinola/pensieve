import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { REQUEST_ID_HEADER, proxy } from "@/proxy";

// Covers ticket 03's checklist: proxy() must stamp every request with a
// correlation ID (generating one when absent, preserving one supplied by an
// upstream caller/load balancer) and surface it back on the response so
// callers can correlate their own logs with ours.
//
// "/login" is used as the request path because it's a PUBLIC_PATHS entry
// (see src/proxy.ts) — proxy() returns immediately via NextResponse.next()
// without touching the database, so these tests exercise only the request-ID
// behavior without needing to mock session/DB lookups.
describe("proxy request correlation ID", () => {
  it("stamps a generated x-request-id response header when the request doesn't carry one", async () => {
    const request = new NextRequest("https://example.com/login");

    const response = await proxy(request);

    const requestId = response.headers.get(REQUEST_ID_HEADER);
    expect(requestId).toBeTruthy();
    // crypto.randomUUID() shape.
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("preserves an existing x-request-id header instead of generating a new one", async () => {
    const existingId = "11111111-2222-3333-4444-555555555555";
    const request = new NextRequest("https://example.com/login", {
      headers: { [REQUEST_ID_HEADER]: existingId },
    });

    const response = await proxy(request);

    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(existingId);
  });

  it("generates a fresh request ID when the header is present but empty", async () => {
    const request = new NextRequest("https://example.com/login", {
      headers: { [REQUEST_ID_HEADER]: "" },
    });

    const response = await proxy(request);

    const requestId = response.headers.get(REQUEST_ID_HEADER);
    expect(requestId).toBeTruthy();
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("generates a different request ID for each request without one", async () => {
    const first = await proxy(new NextRequest("https://example.com/login"));
    const second = await proxy(new NextRequest("https://example.com/login"));

    expect(first.headers.get(REQUEST_ID_HEADER)).not.toBe(second.headers.get(REQUEST_ID_HEADER));
  });

  // Ticket 04's withErrorHandling wrapper needs the request ID readable from
  // inside the route handler (for the JSON error envelope), not just on the
  // outgoing response — so proxy must also forward it onto the downstream
  // request. NextResponse.next({ request: { headers } }) encodes forwarded
  // request headers as `x-middleware-request-*` on the returned response
  // object (see node_modules/next/dist/server/web/spec-extension/response.js)
  // rather than exposing them directly, which is what these assert against.
  it("forwards the (possibly freshly-generated) request ID onto the downstream request, on a public path", async () => {
    const request = new NextRequest("https://example.com/login");

    const response = await proxy(request);

    const forwardedId = response.headers.get(`x-middleware-request-${REQUEST_ID_HEADER}`);
    expect(forwardedId).toBeTruthy();
    expect(forwardedId).toBe(response.headers.get(REQUEST_ID_HEADER));
  });

  it("preserves an incoming request ID on the downstream request too", async () => {
    const existingId = "11111111-2222-3333-4444-555555555555";
    const request = new NextRequest("https://example.com/login", {
      headers: { [REQUEST_ID_HEADER]: existingId },
    });

    const response = await proxy(request);

    expect(response.headers.get(`x-middleware-request-${REQUEST_ID_HEADER}`)).toBe(existingId);
  });
});
