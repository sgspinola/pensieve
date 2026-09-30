import { describe, expect, it } from "vitest";
import { ValidationError } from "@/services/errors";
import { parseOrThrow } from "@/lib/validation";
import { inviteOptionsBodySchema } from "./schema";

describe("inviteOptionsBodySchema", () => {
  it("passes a valid body through unchanged (aside from trimming)", () => {
    const result = parseOrThrow(inviteOptionsBodySchema, {
      token: "tok-123",
      displayName: "Alice",
    });

    expect(result).toEqual({ token: "tok-123", displayName: "Alice" });
  });

  it("trims surrounding whitespace from both fields", () => {
    const result = parseOrThrow(inviteOptionsBodySchema, {
      token: "  tok-123  ",
      displayName: "  Alice  ",
    });

    expect(result).toEqual({ token: "tok-123", displayName: "Alice" });
  });

  it("rejects a missing token with an issue on that field", () => {
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(inviteOptionsBodySchema, { displayName: "Alice" });
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught?.issues).toEqual([{ field: "token", message: expect.any(String) }]);
  });

  it("rejects a missing displayName with an issue on that field", () => {
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(inviteOptionsBodySchema, { token: "tok-123" });
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught?.issues).toEqual([{ field: "displayName", message: expect.any(String) }]);
  });

  it("collects issues for both fields when both are missing", () => {
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(inviteOptionsBodySchema, {});
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught?.issues.map((i) => i.field).sort()).toEqual(["displayName", "token"]);
  });

  it("rejects empty-after-trim values", () => {
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(inviteOptionsBodySchema, { token: "   ", displayName: "   " });
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught?.issues.map((i) => i.field).sort()).toEqual(["displayName", "token"]);
  });

  it("rejects wrong-type fields", () => {
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(inviteOptionsBodySchema, { token: 5, displayName: 5 });
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught?.issues.map((i) => i.field).sort()).toEqual(["displayName", "token"]);
  });
});
