import type { ZodType } from "zod";
import { describe, expect, it } from "vitest";
import { ValidationError } from "@/services/errors";
import { parseOrThrow } from "./validation";
import {
  cascadeQuerySchema,
  cursorParamSchema,
  exportKindParamSchema,
  itemKindFilterSchema,
  limitQuerySchema,
  queryParamSchema,
  tagsQuerySchema,
} from "./query-schemas";

function issuesFor(schema: ZodType, data: unknown): { field: string; message: string }[] {
  try {
    parseOrThrow(schema, data);
    throw new Error("expected parseOrThrow to reject this input");
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    return (err as ValidationError).issues;
  }
}

describe("limitQuerySchema", () => {
  const schema = limitQuerySchema(30, 100);

  it("defaults to defaultValue when absent (null)", () => {
    expect(parseOrThrow(schema, null)).toBe(30);
  });

  it("accepts a valid in-range integer string", () => {
    expect(parseOrThrow(schema, "5")).toBe(5);
    expect(parseOrThrow(schema, "100")).toBe(100);
    expect(parseOrThrow(schema, "1")).toBe(1);
  });

  it("rejects a non-numeric value", () => {
    expect(issuesFor(schema, "not-a-number")).toEqual([
      { field: "", message: "limit must be a positive integer" },
    ]);
  });

  it("rejects a non-integer numeric value", () => {
    expect(issuesFor(schema, "1.5")).toEqual([{ field: "", message: "limit must be a positive integer" }]);
  });

  it("rejects an out-of-range value (over max)", () => {
    expect(issuesFor(schema, "101")).toEqual([{ field: "", message: "limit must be between 1 and 100" }]);
  });

  it("rejects an out-of-range value (zero)", () => {
    expect(issuesFor(schema, "0")).toEqual([{ field: "", message: "limit must be between 1 and 100" }]);
  });

  it("respects a different defaultValue/max pair", () => {
    const other = limitQuerySchema(10, 50);
    expect(parseOrThrow(other, null)).toBe(10);
    expect(issuesFor(other, "51")).toEqual([{ field: "", message: "limit must be between 1 and 50" }]);
  });
});

describe("tagsQuerySchema", () => {
  it("accepts an empty array", () => {
    expect(parseOrThrow(tagsQuerySchema, [])).toEqual([]);
  });

  it("accepts an array of strings", () => {
    expect(parseOrThrow(tagsQuerySchema, ["networking", "security"])).toEqual(["networking", "security"]);
  });
});

describe("itemKindFilterSchema", () => {
  it("accepts an empty array (no kind filter)", () => {
    expect(parseOrThrow(itemKindFilterSchema, [])).toEqual([]);
  });

  it("accepts every creatable kind, including page", () => {
    expect(parseOrThrow(itemKindFilterSchema, ["link", "tool", "article", "page"])).toEqual([
      "link",
      "tool",
      "article",
      "page",
    ]);
  });

  it("rejects an invalid kind", () => {
    expect(issuesFor(itemKindFilterSchema, ["bogus"])).toEqual([
      { field: "[0]", message: 'kind must be "link", "tool", "article", or "page"' },
    ]);
  });

  it("rejects when any entry in a mixed list is invalid", () => {
    expect(issuesFor(itemKindFilterSchema, ["link", "bogus"])).toEqual([
      { field: "[1]", message: 'kind must be "link", "tool", "article", or "page"' },
    ]);
  });
});

describe("exportKindParamSchema", () => {
  it.each(["link", "tool", "article"] as const)("accepts %s", (kind) => {
    expect(parseOrThrow(exportKindParamSchema, kind)).toBe(kind);
  });

  it("rejects page — wiki pages are never a content type here", () => {
    expect(issuesFor(exportKindParamSchema, "page")).toEqual([
      { field: "", message: 'kind must be "link", "tool", or "article"' },
    ]);
  });

  it("rejects a missing kind (null)", () => {
    expect(issuesFor(exportKindParamSchema, null)).toEqual([
      { field: "", message: 'kind must be "link", "tool", or "article"' },
    ]);
  });

  it("rejects an unrecognized kind", () => {
    expect(issuesFor(exportKindParamSchema, "bogus")).toEqual([
      { field: "", message: 'kind must be "link", "tool", or "article"' },
    ]);
  });
});

describe("queryParamSchema", () => {
  it("resolves absent (null) to undefined", () => {
    expect(parseOrThrow(queryParamSchema, null)).toBeUndefined();
  });

  it("passes through any string unchanged", () => {
    expect(parseOrThrow(queryParamSchema, "networking")).toBe("networking");
    expect(parseOrThrow(queryParamSchema, "")).toBe("");
  });
});

describe("cursorParamSchema", () => {
  it("resolves absent (null) to undefined", () => {
    expect(parseOrThrow(cursorParamSchema, null)).toBeUndefined();
  });

  it("passes through any string unchanged (a malformed cursor is rejected downstream, not here)", () => {
    expect(parseOrThrow(cursorParamSchema, "opaque-cursor-token")).toBe("opaque-cursor-token");
  });
});

describe("cascadeQuerySchema", () => {
  it("defaults to false when absent (null)", () => {
    expect(parseOrThrow(cascadeQuerySchema, null)).toBe(false);
  });

  it('accepts "true"', () => {
    expect(parseOrThrow(cascadeQuerySchema, "true")).toBe(true);
  });

  it('accepts "false"', () => {
    expect(parseOrThrow(cascadeQuerySchema, "false")).toBe(false);
  });

  it("rejects a malformed value", () => {
    expect(issuesFor(cascadeQuerySchema, "1")).toEqual([
      { field: "", message: 'cascade must be "true" or "false"' },
    ]);
    expect(issuesFor(cascadeQuerySchema, "TRUE")).toEqual([
      { field: "", message: 'cascade must be "true" or "false"' },
    ]);
    expect(issuesFor(cascadeQuerySchema, "yes")).toEqual([
      { field: "", message: 'cascade must be "true" or "false"' },
    ]);
  });
});
