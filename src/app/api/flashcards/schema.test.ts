import { describe, expect, it } from "vitest";
import { ValidationError } from "@/services/errors";
import { parseOrThrow } from "@/lib/validation";
import { createFlashcardBodySchema, updateFlashcardBodySchema } from "./schema";

function catchValidationError(fn: () => unknown): ValidationError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ValidationError) return err;
    throw err;
  }
  throw new Error("expected parseOrThrow to throw a ValidationError");
}

// POST /api/flashcards's create body (ticket 18, replacing the hand-rolled
// front/back/source/tags checks removed from route.ts). `tags` is validated
// for shape only here — the "at least one tag" business rule stays enforced
// by createFlashcard's hasTags/TAGS_REQUIRED_ERROR check (ticket 04), which
// is already covered against a real database in route.test.ts.
describe("createFlashcardBodySchema", () => {
  const validBody = {
    front: "What is TCP?",
    back: "A transport protocol.",
    source: "https://example.com",
    tags: ["networking"],
  };

  it("accepts a valid body with tags", () => {
    expect(parseOrThrow(createFlashcardBodySchema, validBody)).toEqual(validBody);
  });

  it("accepts a valid body with tags omitted", () => {
    const { tags: _tags, ...withoutTags } = validBody;
    expect(parseOrThrow(createFlashcardBodySchema, withoutTags)).toEqual(withoutTags);
  });

  it("rejects a missing front", () => {
    const { front: _front, ...body } = validBody;
    const err = catchValidationError(() => parseOrThrow(createFlashcardBodySchema, body));
    expect(err.issues).toEqual([{ field: "front", message: expect.any(String) }]);
  });

  it("rejects a non-string front", () => {
    const err = catchValidationError(() => parseOrThrow(createFlashcardBodySchema, { ...validBody, front: 5 }));
    expect(err.issues).toEqual([{ field: "front", message: expect.any(String) }]);
  });

  it("rejects a blank/whitespace-only front", () => {
    const err = catchValidationError(() => parseOrThrow(createFlashcardBodySchema, { ...validBody, front: "   " }));
    expect(err.issues).toEqual([{ field: "front", message: "front is required" }]);
  });

  it("rejects a missing back", () => {
    const { back: _back, ...body } = validBody;
    const err = catchValidationError(() => parseOrThrow(createFlashcardBodySchema, body));
    expect(err.issues).toEqual([{ field: "back", message: expect.any(String) }]);
  });

  it("rejects a blank/whitespace-only back", () => {
    const err = catchValidationError(() => parseOrThrow(createFlashcardBodySchema, { ...validBody, back: "  " }));
    expect(err.issues).toEqual([{ field: "back", message: "back is required" }]);
  });

  it("rejects a missing source", () => {
    const { source: _source, ...body } = validBody;
    const err = catchValidationError(() => parseOrThrow(createFlashcardBodySchema, body));
    expect(err.issues).toEqual([{ field: "source", message: expect.any(String) }]);
  });

  it("rejects a blank/whitespace-only source", () => {
    const err = catchValidationError(() => parseOrThrow(createFlashcardBodySchema, { ...validBody, source: "  " }));
    expect(err.issues).toEqual([{ field: "source", message: "source is required" }]);
  });

  it("rejects a non-array tags field", () => {
    const err = catchValidationError(() =>
      parseOrThrow(createFlashcardBodySchema, { ...validBody, tags: "networking" }),
    );
    expect(err.issues).toEqual([{ field: "tags", message: expect.any(String) }]);
  });

  it("rejects a tags array containing a non-string entry", () => {
    const err = catchValidationError(() => parseOrThrow(createFlashcardBodySchema, { ...validBody, tags: [1, 2] }));
    expect(err.issues.length).toBeGreaterThan(0);
    expect(err.issues[0]?.field).toMatch(/^tags\[\d+\]$/);
  });

  it("accepts an explicit empty tags array at the shape level (business rule enforced downstream)", () => {
    expect(parseOrThrow(createFlashcardBodySchema, { ...validBody, tags: [] })).toEqual({ ...validBody, tags: [] });
  });

  it("rejects a non-object body", () => {
    const err = catchValidationError(() => parseOrThrow(createFlashcardBodySchema, null));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.issues.length).toBeGreaterThan(0);
  });

  it("reports every distinct invalid field in a single issues array", () => {
    const err = catchValidationError(() =>
      parseOrThrow(createFlashcardBodySchema, { front: "", back: "", source: "" }),
    );
    expect(err.issues).toEqual([
      { field: "front", message: "front is required" },
      { field: "back", message: "back is required" },
      { field: "source", message: "source is required" },
    ]);
  });
});

// PATCH /api/flashcards/[id]'s update body (ticket 18, replacing the
// hand-rolled front/back/source/tags type checks removed from route.ts) —
// same fields as create, all optional, since an omitted field means "leave
// unchanged" (see UpdateFlashcardInput).
describe("updateFlashcardBodySchema", () => {
  it("accepts an empty body (every field omitted)", () => {
    expect(parseOrThrow(updateFlashcardBodySchema, {})).toEqual({});
  });

  it("accepts a body with only one field provided", () => {
    expect(parseOrThrow(updateFlashcardBodySchema, { front: "Revised" })).toEqual({ front: "Revised" });
  });

  it("accepts a body with every field provided", () => {
    const body = { front: "F", back: "B", source: "S", tags: ["a", "b"] };
    expect(parseOrThrow(updateFlashcardBodySchema, body)).toEqual(body);
  });

  it("rejects a non-string front when provided", () => {
    const err = catchValidationError(() => parseOrThrow(updateFlashcardBodySchema, { front: 5 }));
    expect(err.issues).toEqual([{ field: "front", message: expect.any(String) }]);
  });

  it("rejects a non-string back when provided", () => {
    const err = catchValidationError(() => parseOrThrow(updateFlashcardBodySchema, { back: 5 }));
    expect(err.issues).toEqual([{ field: "back", message: expect.any(String) }]);
  });

  it("rejects a non-string source when provided", () => {
    const err = catchValidationError(() => parseOrThrow(updateFlashcardBodySchema, { source: 5 }));
    expect(err.issues).toEqual([{ field: "source", message: expect.any(String) }]);
  });

  it("rejects a non-array tags field when provided", () => {
    const err = catchValidationError(() => parseOrThrow(updateFlashcardBodySchema, { tags: "networking" }));
    expect(err.issues).toEqual([{ field: "tags", message: expect.any(String) }]);
  });

  it("rejects a tags array containing a non-string entry", () => {
    const err = catchValidationError(() => parseOrThrow(updateFlashcardBodySchema, { tags: [1] }));
    expect(err.issues).toEqual([{ field: "tags[0]", message: expect.any(String) }]);
  });

  it("accepts an explicit empty tags array at the shape level (business rule enforced downstream)", () => {
    expect(parseOrThrow(updateFlashcardBodySchema, { tags: [] })).toEqual({ tags: [] });
  });

  it("rejects a non-object body", () => {
    const err = catchValidationError(() => parseOrThrow(updateFlashcardBodySchema, null));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.issues.length).toBeGreaterThan(0);
  });
});
