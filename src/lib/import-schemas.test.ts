import { describe, expect, it } from "vitest";
import { ValidationError } from "@/services/errors";
import { importFileBodySchema, itemImportBodySchema } from "@/lib/import-schemas";
import { parseOrThrow } from "@/lib/validation";

function catchValidationError(fn: () => unknown): ValidationError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ValidationError) return err;
    throw err;
  }
  throw new Error("expected parseOrThrow to throw a ValidationError");
}

// POST /api/flashcards/import and POST /api/flashcards/import/preview's
// shared body-shape check (ticket 06, migrated off the hand-rolled
// parseImportFileBody by ticket 20) — the rest of each route's behavior is
// already covered against real fixtures in flashcards-import.test.ts.
describe("importFileBodySchema (flashcards/import, flashcards/import/preview)", () => {
  it("accepts a body with a non-empty string file", () => {
    const body = { file: "---\nfront: Q\n---\nA" };
    expect(parseOrThrow(importFileBodySchema, body)).toEqual(body);
  });

  it("rejects a missing file field", () => {
    const err = catchValidationError(() => parseOrThrow(importFileBodySchema, {}));
    expect(err.issues).toEqual([{ field: "file", message: expect.any(String) }]);
  });

  it("rejects a non-string file field", () => {
    const err = catchValidationError(() => parseOrThrow(importFileBodySchema, { file: 42 }));
    expect(err.issues).toEqual([{ field: "file", message: expect.any(String) }]);
  });

  it("rejects an empty/whitespace-only file", () => {
    const err = catchValidationError(() => parseOrThrow(importFileBodySchema, { file: "   " }));
    expect(err.issues).toEqual([{ field: "file", message: "file is required" }]);
  });

  it("rejects a non-object body", () => {
    const err = catchValidationError(() => parseOrThrow(importFileBodySchema, null));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.issues.length).toBeGreaterThan(0);
  });
});

// POST /api/items/import and POST /api/items/import/preview's shared
// body-shape check (ticket 07, migrated off the hand-rolled
// parseItemImportBody/parseKindAndFileBody by ticket 20) — the rest of each
// route's behavior is already covered against real fixtures in
// items-import.test.ts.
describe("itemImportBodySchema (items/import, items/import/preview)", () => {
  it("accepts a body with a valid kind and non-empty file", () => {
    const body = { kind: "link", file: "---\ntitle: Q\n---\nA" };
    expect(parseOrThrow(itemImportBodySchema, body)).toEqual(body);
  });

  it("rejects a missing kind", () => {
    const err = catchValidationError(() => parseOrThrow(itemImportBodySchema, { file: "x" }));
    expect(err.issues).toEqual([{ field: "kind", message: 'kind must be "link", "tool", or "article"' }]);
  });

  it("rejects an invalid kind, including the non-importable 'page' kind", () => {
    for (const kind of ["page", "bogus"]) {
      const err = catchValidationError(() => parseOrThrow(itemImportBodySchema, { kind, file: "x" }));
      expect(err.issues).toEqual([{ field: "kind", message: 'kind must be "link", "tool", or "article"' }]);
    }
  });

  it("rejects a missing/empty file", () => {
    const missingFile = catchValidationError(() => parseOrThrow(itemImportBodySchema, { kind: "tool" }));
    expect(missingFile.issues).toEqual([{ field: "file", message: expect.any(String) }]);

    const blankFile = catchValidationError(() =>
      parseOrThrow(itemImportBodySchema, { kind: "tool", file: "   " }),
    );
    expect(blankFile.issues).toEqual([{ field: "file", message: "file is required" }]);
  });

  it("rejects a non-object body", () => {
    const err = catchValidationError(() => parseOrThrow(itemImportBodySchema, null));
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.issues.length).toBeGreaterThan(0);
  });
});
