import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ValidationError } from "@/services/errors";
import { parseOrThrow } from "./validation";

describe("parseOrThrow", () => {
  it("returns the parsed value unchanged on valid input", () => {
    const schema = z.object({ title: z.string(), count: z.number() });
    const input = { title: "hello", count: 3 };

    expect(parseOrThrow(schema, input)).toEqual(input);
  });

  it("applies schema-declared narrowing (e.g. defaults) but nothing beyond it", () => {
    const schema = z.object({ title: z.string(), archived: z.boolean().default(false) });

    expect(parseOrThrow(schema, { title: "hello" })).toEqual({ title: "hello", archived: false });
  });

  it("throws ValidationError, not a raw ZodError, on invalid input", () => {
    const schema = z.object({ title: z.string() });

    expect(() => parseOrThrow(schema, { title: 5 })).toThrow(ValidationError);
  });

  it("does not silently coerce a type the schema didn't declare coercion for", () => {
    const schema = z.object({ count: z.number() });

    expect(() => parseOrThrow(schema, { count: "3" })).toThrow(ValidationError);
  });

  it("collects every simultaneous violation into one ValidationError with one issues entry each", () => {
    const schema = z.object({
      title: z.string(),
      count: z.number(),
      email: z.string().email(),
    });

    let caught: ValidationError | undefined;
    try {
      parseOrThrow(schema, { title: 5, count: "nope", email: "not-an-email" });
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.issues).toHaveLength(3);
    expect(caught?.issues.map((i) => i.field).sort()).toEqual(["count", "email", "title"]);
    expect(caught?.issues.every((i) => typeof i.message === "string" && i.message.length > 0)).toBe(true);
  });

  it("formats a nested object path as dot notation, e.g. address.city", () => {
    const schema = z.object({ address: z.object({ city: z.string() }) });

    let caught: ValidationError | undefined;
    try {
      parseOrThrow(schema, { address: { city: 5 } });
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught?.issues).toEqual([{ field: "address.city", message: expect.any(String) }]);
  });

  it("formats an array index path as bracket notation, e.g. tags[1]", () => {
    const schema = z.object({ tags: z.array(z.string()) });

    let caught: ValidationError | undefined;
    try {
      parseOrThrow(schema, { tags: ["ok", 5] });
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught?.issues).toEqual([{ field: "tags[1]", message: expect.any(String) }]);
  });

  it("uses an empty string field for a root-level (pathless) issue", () => {
    const schema = z.object({ a: z.string(), b: z.string() }).refine((v) => v.a !== v.b, {
      message: "a and b must differ",
    });

    let caught: ValidationError | undefined;
    try {
      parseOrThrow(schema, { a: "x", b: "x" });
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught?.issues).toEqual([{ field: "", message: "a and b must differ" }]);
  });
});
