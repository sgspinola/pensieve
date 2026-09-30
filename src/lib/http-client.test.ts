import { describe, expect, it } from "vitest";
import { readErrorMessage } from "@/lib/http-client";

// readErrorMessage is the shared client-side helper every form in this app
// calls to turn a failed API response into a displayable message. Two error
// body shapes exist side by side right now: the legacy flat `{ error: "..." }`
// toErrorResponse() has always produced, and the new nested
// `{ error: { code, message, requestId } }` envelope withErrorHandling()
// (ticket 04) produces for its pilot routes — this must keep working for
// both until tickets 05–07 finish migrating every route off the old shape.
describe("readErrorMessage", () => {
  it("reads the legacy flat { error: string } shape", async () => {
    const response = new Response(JSON.stringify({ error: "code is required" }), { status: 400 });

    expect(await readErrorMessage(response)).toBe("code is required");
  });

  it("reads the message out of the new { error: { code, message } } envelope", async () => {
    const response = new Response(
      JSON.stringify({ error: { code: "NOT_FOUND", message: "Recovery code not found", requestId: "req-1" } }),
      { status: 404 },
    );

    expect(await readErrorMessage(response)).toBe("Recovery code not found");
  });

  it("falls back to a generic message for a response that isn't JSON-shaped that way", async () => {
    const response = new Response("<html>not json</html>", { status: 502 });

    expect(await readErrorMessage(response)).toBe("Something went wrong");
  });

  it("falls back to a generic message when the envelope has neither shape", async () => {
    const response = new Response(JSON.stringify({ error: { requestId: "req-2" } }), { status: 500 });

    expect(await readErrorMessage(response)).toBe("Something went wrong");
  });
});
