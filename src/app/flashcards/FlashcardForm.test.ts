import { describe, expect, it } from "vitest";
import {
  buildFlashcardRequest,
  isFlashcardFormDirty,
  TAGS_REQUIRED_ERROR,
  validateFlashcardFormValues,
} from "./FlashcardForm";

/**
 * `FlashcardForm` is shared between `/flashcards/new` (create) and the
 * ticket-06 edit modal (edit) — these are the two pure logic seams it
 * exports so create-vs-edit request-building and the modal's dirty-check
 * (used to gate a discard-changes confirmation) are unit-testable without
 * rendering the component (which pulls in `MarkdownEditor`/`@uiw/react-md-editor`
 * — deliberately never rendered under this repo's jsdom-less Vitest, same
 * reasoning as `FlashcardsManager.test.ts`'s empty-`flashcards` comment).
 */
describe("buildFlashcardRequest", () => {
  it("posts to /api/flashcards in create mode", () => {
    expect(
      buildFlashcardRequest(
        { kind: "create" },
        { front: "Q", back: "A", source: "https://example.com", tags: ["x"] },
      ),
    ).toEqual({
      url: "/api/flashcards",
      method: "POST",
      body: { front: "Q", back: "A", source: "https://example.com", tags: ["x"] },
    });
  });

  it("patches /api/flashcards/[id] in edit mode", () => {
    expect(
      buildFlashcardRequest(
        { kind: "edit", flashcardId: "card-1" },
        { front: "Q2", back: "A2", source: "https://example.com/2", tags: [] },
      ),
    ).toEqual({
      url: "/api/flashcards/card-1",
      method: "PATCH",
      body: { front: "Q2", back: "A2", source: "https://example.com/2", tags: [] },
    });
  });
});

describe("isFlashcardFormDirty", () => {
  const initial = { front: "Q", back: "A", source: "https://example.com", tags: ["ai", "ml"] };

  it("is false when current values exactly match the initial values", () => {
    expect(isFlashcardFormDirty({ ...initial }, initial)).toBe(false);
  });

  it("is true when front changed", () => {
    expect(isFlashcardFormDirty({ ...initial, front: "Q2" }, initial)).toBe(true);
  });

  it("is true when back changed", () => {
    expect(isFlashcardFormDirty({ ...initial, back: "A2" }, initial)).toBe(true);
  });

  it("is true when source changed", () => {
    expect(isFlashcardFormDirty({ ...initial, source: "https://example.com/2" }, initial)).toBe(true);
  });

  it("is true when a tag was added", () => {
    expect(isFlashcardFormDirty({ ...initial, tags: ["ai", "ml", "new"] }, initial)).toBe(true);
  });

  it("is true when a tag was removed", () => {
    expect(isFlashcardFormDirty({ ...initial, tags: ["ai"] }, initial)).toBe(true);
  });
});

/**
 * Save-time mandatory-tags validation (ticket 04). Used by `handleSubmit`
 * in both create and edit mode (the same code path), so one set of cases
 * covers both — the mode-specific difference (create's `/flashcards/new`
 * vs. the edit modal) only affects what happens on a *valid* submit, not
 * this check itself. `TagsInput` (src/app/items/TagsInput.tsx) is
 * deliberately untouched — a user can freely remove their last tag chip
 * there; only Save is blocked, exercised here via this pure function
 * rather than a render test (see the file-level comment above for why
 * FlashcardForm itself isn't rendered under this repo's jsdom-less Vitest).
 */
describe("validateFlashcardFormValues", () => {
  it("returns the required-tag error when tags is empty", () => {
    expect(
      validateFlashcardFormValues({ front: "Q", back: "A", source: "https://example.com", tags: [] }),
    ).toBe(TAGS_REQUIRED_ERROR);
  });

  it("returns null when at least one tag is present", () => {
    expect(
      validateFlashcardFormValues({ front: "Q", back: "A", source: "https://example.com", tags: ["ai"] }),
    ).toBeNull();
  });
});
