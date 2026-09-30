import { describe, expect, it } from "vitest";
import { ValidationError } from "@/services/errors";
import { parseOrThrow } from "@/lib/validation";
import { metadataBodySchema } from "./schema";

function issuesFor(body: unknown): { field: string; message: string }[] {
  try {
    parseOrThrow(metadataBodySchema, body);
    throw new Error("expected parseOrThrow to reject this body");
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    return (err as ValidationError).issues;
  }
}

describe("metadataBodySchema", () => {
  it("accepts a valid URL", () => {
    const result = parseOrThrow(metadataBodySchema, { url: "https://example.com" });
    expect(result).toEqual({ url: "https://example.com" });
  });

  it("trims surrounding whitespace from the URL", () => {
    const result = parseOrThrow(metadataBodySchema, { url: "  https://example.com  " });
    expect(result).toEqual({ url: "https://example.com" });
  });

  it("rejects a missing url", () => {
    expect(issuesFor({})).toEqual([{ field: "url", message: "url is required" }]);
  });

  it("rejects a non-string url", () => {
    expect(issuesFor({ url: 5 })).toEqual([{ field: "url", message: "url is required" }]);
  });

  it("rejects a blank url", () => {
    expect(issuesFor({ url: "   " })).toEqual([{ field: "url", message: "url is required" }]);
  });

  it("rejects a malformed (non-URL) url", () => {
    expect(issuesFor({ url: "not-a-url" })).toEqual([
      { field: "url", message: "url must be a valid URL" },
    ]);
  });

  it("rejects a null body", () => {
    const issues = issuesFor(null);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("");
  });
});
