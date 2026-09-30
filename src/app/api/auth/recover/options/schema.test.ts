import { describe, expect, it } from "vitest";
import { ValidationError } from "@/services/errors";
import { parseOrThrow } from "@/lib/validation";
import { recoverOptionsBodySchema } from "./schema";

describe("recoverOptionsBodySchema", () => {
  it("passes a valid body through unchanged (aside from trimming)", () => {
    const result = parseOrThrow(recoverOptionsBodySchema, { code: "abc-123" });

    expect(result).toEqual({ code: "abc-123" });
  });

  it("trims surrounding whitespace from code", () => {
    const result = parseOrThrow(recoverOptionsBodySchema, { code: "  abc-123  " });

    expect(result).toEqual({ code: "abc-123" });
  });

  it("rejects a missing code with an issue on that field", () => {
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(recoverOptionsBodySchema, {});
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.issues).toEqual([{ field: "code", message: expect.any(String) }]);
  });

  it("rejects an empty-after-trim code", () => {
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(recoverOptionsBodySchema, { code: "   " });
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught?.issues).toEqual([{ field: "code", message: expect.any(String) }]);
  });

  it("rejects a non-string code", () => {
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(recoverOptionsBodySchema, { code: 5 });
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught?.issues).toEqual([{ field: "code", message: expect.any(String) }]);
  });

  it("rejects a null body", () => {
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(recoverOptionsBodySchema, null);
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.issues.length).toBeGreaterThan(0);
  });
});
