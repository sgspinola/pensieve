import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FlashcardRow } from "./FlashcardRow";

/**
 * `FlashcardRow` uses hooks (`useState`/`useRef`/`useEffect`) but no
 * `next/navigation` hooks, so — same reasoning as `Modal.test.ts` — it's
 * rendered via `renderToStaticMarkup` rather than called directly as a plain
 * function (React rejects a hook call outside an active render pass).
 * Effects never run under SSR, so this only covers the static wiring: ticket
 * 01's collapsed-by-default Answer and ticket 02's width-expand toggle both
 * start from their initial `useState`/prop values, not interactive
 * toggling (reveal/hide animation, overlay positioning) — those are covered
 * by the Playwright specs (per this repo's Vitest-is-non-interactive
 * convention) and by manual `next dev` verification.
 */
function baseProps() {
  return {
    flashcard: {
      id: "card-1",
      front: "Question text",
      back: "Answer text",
      frontHash: "hash-1",
      source: "https://example.com",
      tags: [],
      createdBy: "user-1",
      createdByName: "Ada",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    currentUser: { id: "user-1", displayName: "Ada", role: "member" as const },
    isEditing: false,
    onEditToggle: () => {},
    onChanged: () => {},
    tagSuggestions: [],
    isExpanded: false,
    onExpandToggle: () => {},
    isInert: false,
  };
}

describe("FlashcardRow answer reveal toggle (ticket 01)", () => {
  it("renders the Answer collapsed by default, with a chevron toggle reflecting that state", () => {
    const html = renderToStaticMarkup(createElement(FlashcardRow, baseProps()));

    expect(html).toContain('aria-label="Show answer"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-label="Hide answer"');
  });

  it("always renders the Question fully, with no reveal toggle of its own", () => {
    const html = renderToStaticMarkup(createElement(FlashcardRow, baseProps()));

    // Only one reveal toggle exists (Answer's) — Question has no matching control.
    expect((html.match(/aria-label="Show answer"/g) ?? []).length).toBe(1);
    expect(html).toContain("Question text");
  });
});

describe("FlashcardRow width-expand toggle (ticket 02)", () => {
  it("renders collapsed (not overlaid) by default, with an expand toggle", () => {
    const html = renderToStaticMarkup(createElement(FlashcardRow, baseProps()));

    expect(html).toContain('aria-label="Expand flashcard"');
    expect(html).not.toContain('aria-label="Collapse flashcard"');
  });

  it("reflects an expanded state and marks itself as the (non-inert) overlay when isExpanded is true", () => {
    const html = renderToStaticMarkup(createElement(FlashcardRow, { ...baseProps(), isExpanded: true }));

    expect(html).toContain('aria-label="Collapse flashcard"');
    expect(html).not.toContain("inert=");
  });

  it("marks itself inert when another card's overlay is open", () => {
    const html = renderToStaticMarkup(createElement(FlashcardRow, { ...baseProps(), isInert: true }));

    expect(html).toContain("inert=");
  });
});

describe("FlashcardRow footer (source + tags pinned to the card bottom)", () => {
  it("renders Tags before Source, both after the Question and Answer content", () => {
    const base = baseProps();
    const props = { ...base, flashcard: { ...base.flashcard, tags: ["react", "testing"] } };
    const html = renderToStaticMarkup(createElement(FlashcardRow, props));

    const questionIndex = html.indexOf("Question text");
    const tagsIndex = html.indexOf("Tags:");
    const sourceIndex = html.indexOf("Source:");

    expect(questionIndex).toBeGreaterThanOrEqual(0);
    expect(tagsIndex).toBeGreaterThan(questionIndex);
    expect(sourceIndex).toBeGreaterThan(tagsIndex);
    expect(html).toContain("react");
    expect(html).toContain("testing");
  });

  it("still renders Source when there are no tags", () => {
    const html = renderToStaticMarkup(createElement(FlashcardRow, baseProps()));

    expect(html).toContain("Source:");
    expect(html).not.toContain("Tags:");
  });
});
