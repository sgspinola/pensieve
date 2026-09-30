import { describe, expect, it } from "vitest";
import { ValidationError } from "@/services/errors";
import { parseOrThrow } from "@/lib/validation";
import { createItemBodySchema } from "./schema";

function issuesFor(body: unknown): { field: string; message: string }[] {
  try {
    parseOrThrow(createItemBodySchema, body);
    throw new Error("expected parseOrThrow to reject this body");
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    return (err as ValidationError).issues;
  }
}

describe("createItemBodySchema", () => {
  it("accepts a valid link body", () => {
    const result = parseOrThrow(createItemBodySchema, {
      kind: "link",
      url: "https://example.com",
    });
    expect(result).toEqual({ kind: "link", url: "https://example.com" });
  });

  it("accepts a valid link body with tags, parentId, description, and notes", () => {
    const result = parseOrThrow(createItemBodySchema, {
      kind: "tool",
      url: "https://example.com",
      title: "A tool",
      description: "desc",
      notes: "notes",
      tags: ["a", "b"],
      parentId: null,
    });
    expect(result).toEqual({
      kind: "tool",
      url: "https://example.com",
      title: "A tool",
      description: "desc",
      notes: "notes",
      tags: ["a", "b"],
      parentId: null,
    });
  });

  it("accepts a valid page body (title + content, no url)", () => {
    const result = parseOrThrow(createItemBodySchema, {
      kind: "page",
      title: "My page",
      content: "some markdown",
    });
    expect(result).toEqual({ kind: "page", title: "My page", content: "some markdown" });
  });

  it("rejects a missing kind", () => {
    expect(issuesFor({})).toEqual([
      { field: "kind", message: 'kind must be "link", "tool", "article", or "page"' },
    ]);
  });

  it("rejects an invalid kind", () => {
    expect(issuesFor({ kind: "bogus" })).toEqual([
      { field: "kind", message: 'kind must be "link", "tool", "article", or "page"' },
    ]);
  });

  it("rejects a non-string, wrong-type kind", () => {
    expect(issuesFor({ kind: 5 })).toEqual([
      { field: "kind", message: 'kind must be "link", "tool", "article", or "page"' },
    ]);
  });

  it("rejects a page body missing title", () => {
    expect(issuesFor({ kind: "page", content: "x" })).toEqual([
      { field: "title", message: "title is required" },
    ]);
  });

  it("rejects a page body missing both title and content with one issue each", () => {
    expect(issuesFor({ kind: "page" })).toEqual([
      { field: "title", message: "title is required" },
      { field: "content", message: "content is required" },
    ]);
  });

  it("rejects a page body with a blank title", () => {
    expect(issuesFor({ kind: "page", title: "   ", content: "x" })).toEqual([
      { field: "title", message: "title is required" },
    ]);
  });

  it("rejects a page body missing content", () => {
    expect(issuesFor({ kind: "page", title: "T" })).toEqual([
      { field: "content", message: "content is required" },
    ]);
  });

  it("rejects a page body with blank content", () => {
    expect(issuesFor({ kind: "page", title: "T", content: "   " })).toEqual([
      { field: "content", message: "content is required" },
    ]);
  });

  it("rejects a non-page body missing url", () => {
    expect(issuesFor({ kind: "link" })).toEqual([{ field: "url", message: "url is required" }]);
  });

  it("rejects a non-page body with a blank url", () => {
    expect(issuesFor({ kind: "link", url: "   " })).toEqual([
      { field: "url", message: "url is required" },
    ]);
  });

  it("rejects a non-page body with a non-string url", () => {
    expect(issuesFor({ kind: "link", url: 5 })).toEqual([
      { field: "url", message: "url is required" },
    ]);
  });

  it("rejects tags that are not an array", () => {
    expect(issuesFor({ kind: "link", url: "https://example.com", tags: "not-an-array" })).toEqual([
      { field: "tags", message: "tags must be an array of strings" },
    ]);
  });

  it("rejects tags with non-string entries", () => {
    expect(issuesFor({ kind: "link", url: "https://example.com", tags: [1, 2] })).toEqual([
      { field: "tags", message: "tags must be an array of strings" },
    ]);
  });

  it("rejects a non-string, non-null parentId", () => {
    expect(issuesFor({ kind: "link", url: "https://example.com", parentId: 5 })).toEqual([
      { field: "parentId", message: "parentId must be a string or null" },
    ]);
  });

  it("rejects a non-string, non-null description", () => {
    expect(issuesFor({ kind: "link", url: "https://example.com", description: 5 })).toEqual([
      { field: "description", message: "description must be a string or null" },
    ]);
  });

  it("rejects a non-string, non-null notes", () => {
    expect(issuesFor({ kind: "link", url: "https://example.com", notes: 5 })).toEqual([
      { field: "notes", message: "notes must be a string or null" },
    ]);
  });

  it("rejects a non-string, non-null title on a non-page kind", () => {
    expect(issuesFor({ kind: "link", url: "https://example.com", title: 5 })).toEqual([
      { field: "title", message: "title must be a string or null" },
    ]);
  });
});
