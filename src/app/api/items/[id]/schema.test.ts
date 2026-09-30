import { describe, expect, it } from "vitest";
import { ValidationError } from "@/services/errors";
import { parseOrThrow } from "@/lib/validation";
import { updateItemBodySchema } from "./schema";

function issuesFor(body: unknown): { field: string; message: string }[] {
  try {
    parseOrThrow(updateItemBodySchema, body);
    throw new Error("expected parseOrThrow to reject this body");
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    return (err as ValidationError).issues;
  }
}

describe("updateItemBodySchema", () => {
  it("accepts an empty body (no fields updated)", () => {
    expect(parseOrThrow(updateItemBodySchema, {})).toEqual({});
  });

  it("accepts a full valid body", () => {
    const body = {
      url: "https://example.com",
      title: "New title",
      description: "desc",
      notes: "notes",
      content: "markdown",
      tags: ["a", "b"],
      parentId: null,
    };
    expect(parseOrThrow(updateItemBodySchema, body)).toEqual(body);
  });

  it("accepts a partial body with only one field", () => {
    expect(parseOrThrow(updateItemBodySchema, { title: "New title" })).toEqual({
      title: "New title",
    });
  });

  it("accepts null for nullable fields (url, description, notes, content, parentId)", () => {
    const body = { url: null, description: null, notes: null, content: null, parentId: null };
    expect(parseOrThrow(updateItemBodySchema, body)).toEqual(body);
  });

  it("rejects an attempt to change kind, even to its current value", () => {
    expect(issuesFor({ kind: "link" })).toEqual([{ field: "kind", message: "kind cannot be changed" }]);
  });

  it("rejects a non-string, non-null url", () => {
    expect(issuesFor({ url: 5 })).toEqual([{ field: "url", message: "url must be a string or null" }]);
  });

  it("rejects a non-string title", () => {
    expect(issuesFor({ title: 5 })).toEqual([{ field: "title", message: "title must be a string" }]);
  });

  it("rejects a null title (title is not nullable, unlike url/description/notes/content)", () => {
    expect(issuesFor({ title: null })).toEqual([{ field: "title", message: "title must be a string" }]);
  });

  it("rejects a non-string, non-null description", () => {
    expect(issuesFor({ description: 5 })).toEqual([
      { field: "description", message: "description must be a string or null" },
    ]);
  });

  it("rejects a non-string, non-null notes", () => {
    expect(issuesFor({ notes: 5 })).toEqual([{ field: "notes", message: "notes must be a string or null" }]);
  });

  it("rejects a non-string, non-null content", () => {
    expect(issuesFor({ content: 5 })).toEqual([
      { field: "content", message: "content must be a string or null" },
    ]);
  });

  it("rejects tags that are not an array", () => {
    expect(issuesFor({ tags: "not-an-array" })).toEqual([
      { field: "tags", message: "tags must be an array of strings" },
    ]);
  });

  it("rejects tags with non-string entries", () => {
    expect(issuesFor({ tags: [1, 2] })).toEqual([
      { field: "tags", message: "tags must be an array of strings" },
    ]);
  });

  it("rejects a non-string, non-null parentId", () => {
    expect(issuesFor({ parentId: 5 })).toEqual([
      { field: "parentId", message: "parentId must be a string or null" },
    ]);
  });
});
