import { describe, expect, it } from "vitest";
import { clientFields } from "@/lib/client-fields";

describe("clientFields (ticket 61)", () => {
  it("reads the client's IP, user agent and ray ID from Cloudflare's headers", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.7",
      "user-agent": "Mozilla/5.0 (test)",
      "cf-ray": "8c1f2e3d4a5b6c7d-ARN",
    });

    expect(clientFields(headers)).toEqual({
      clientIp: "203.0.113.7",
      userAgent: "Mozilla/5.0 (test)",
      cfRay: "8c1f2e3d4a5b6c7d-ARN",
    });
  });

  it("omits absent headers rather than faking them, as in local development", () => {
    expect(clientFields(new Headers({ "user-agent": "curl/8" }))).toEqual({ userAgent: "curl/8" });
    expect(clientFields(new Headers())).toEqual({});
  });

  it("never falls back to X-Forwarded-For, which any client can set", () => {
    expect(clientFields(new Headers({ "x-forwarded-for": "198.51.100.1" }))).toEqual({});
  });
});
