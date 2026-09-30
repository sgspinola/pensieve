import { describe, expect, it } from "vitest";
import { hasTags, TAGS_REQUIRED_ERROR } from "./validation";

/**
 * The shared "at least one tag" check behind createFlashcard, updateFlashcard,
 * flashcards-import.ts, and FlashcardForm's client-side validation — a plain,
 * client-safe predicate so all four call sites (server and client) agree on
 * exactly one rule instead of four hand-rolled copies.
 */
describe("hasTags", () => {
  it("is false for an empty list", () => {
    expect(hasTags([])).toBe(false);
  });

  it("is true when at least one tag is present", () => {
    expect(hasTags(["networking"])).toBe(true);
  });

  it("is true for multiple tags", () => {
    expect(hasTags(["networking", "cryptography"])).toBe(true);
  });
});

describe("TAGS_REQUIRED_ERROR", () => {
  it("is a non-empty message", () => {
    expect(TAGS_REQUIRED_ERROR.length).toBeGreaterThan(0);
  });
});
