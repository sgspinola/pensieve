import { describe, expect, it } from "vitest";
import { ValidationError } from "@/services/errors";
import { parseOrThrow } from "@/lib/validation";
import { registerOptionsBodySchema } from "./schema";

describe("registerOptionsBodySchema", () => {
  it("passes a valid body through unchanged (aside from trimming)", () => {
    const result = parseOrThrow(registerOptionsBodySchema, { displayName: "Alice" });

    expect(result).toEqual({ displayName: "Alice" });
  });

  it("trims surrounding whitespace from displayName", () => {
    const result = parseOrThrow(registerOptionsBodySchema, { displayName: "  Alice  " });

    expect(result).toEqual({ displayName: "Alice" });
  });

  it("rejects a missing displayName with an issue on that field", () => {
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(registerOptionsBodySchema, {});
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.issues).toEqual([{ field: "displayName", message: expect.any(String) }]);
  });

  it("rejects an empty-after-trim displayName", () => {
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(registerOptionsBodySchema, { displayName: "   " });
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught?.issues).toEqual([{ field: "displayName", message: expect.any(String) }]);
  });

  it("rejects a non-string displayName", () => {
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(registerOptionsBodySchema, { displayName: 5 });
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught?.issues).toEqual([{ field: "displayName", message: expect.any(String) }]);
  });

  it("rejects a null body", () => {
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(registerOptionsBodySchema, null);
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.issues.length).toBeGreaterThan(0);
  });
});
