import { describe, expect, it } from "vitest";
import { ValidationError } from "@/services/errors";
import { parseOrThrow } from "@/lib/validation";
import { idParamSchema } from "./request-fields";

describe("idParamSchema", () => {
  it("returns the id unchanged when it is a well-formed UUID", () => {
    const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

    expect(parseOrThrow(idParamSchema, id)).toBe(id);
  });

  it("throws ValidationError with a field-level issue when the id is not a UUID", () => {
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(idParamSchema, "not-a-uuid");
    } catch (err) {
      caught = err as ValidationError;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.issues).toEqual([{ field: "", message: expect.any(String) }]);
  });
});
