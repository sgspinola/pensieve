import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Flashcard } from "./Flashcard";
import type { SerializedFlashcard } from "@/app/flashcards/types";

/**
 * `Flashcard` uses hooks (`useState`/`useRef`/`useLayoutEffect`) and Motion's
 * `useReducedMotion`, but no `next/navigation` hooks, so — same reasoning as
 * `FlashcardRow.test.ts` — it's rendered via `renderToStaticMarkup` rather
 * than called directly as a plain function (React rejects a hook call
 * outside an active render pass). Effects never run under SSR, so this only
 * covers the static wiring (which face renders what markup for a given
 * `flipped` prop), not the flip animation itself — that's covered by
 * Playwright specs per this repo's Vitest-is-non-interactive convention.
 */
function baseCard(overrides: Partial<SerializedFlashcard> = {}): SerializedFlashcard {
  return {
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
    ...overrides,
  };
}

describe("Flashcard answer-side tags (ticket 03)", () => {
  it("shows the card's tags on the flipped (back/answer) face", () => {
    const card = baseCard({ tags: ["react", "testing"] });
    const html = renderToStaticMarkup(createElement(Flashcard, { card, flipped: true }));

    expect(html).toContain("Tags:");
    expect(html).toContain("react");
    expect(html).toContain("testing");
  });

  it("never renders tags within the front face's own markup, even when the card has tags", () => {
    // Both faces are always mounted (required for the 3D flip illusion — see
    // Flashcard.tsx's doc comment), with `aria-hidden` toggling which one is
    // exposed, so the back face's markup exists in the tree regardless of
    // `flipped`. What must hold structurally is that the *front* face's own
    // markup — everything up to where the back face's answer content
    // starts — never contains a tags row.
    const card = baseCard({ tags: ["react", "testing"] });
    const html = renderToStaticMarkup(createElement(Flashcard, { card, flipped: false }));
    const frontFaceMarkup = html.slice(0, html.indexOf("Answer text"));

    expect(frontFaceMarkup).toContain("Question text");
    expect(frontFaceMarkup).not.toContain("Tags:");
  });

  it("shows no tags row at all when the card has no tags", () => {
    const card = baseCard({ tags: [] });
    const html = renderToStaticMarkup(createElement(Flashcard, { card, flipped: true }));

    expect(html).not.toContain("Tags:");
  });

  it("groups the tags row with the source citation at the bottom of the answer face", () => {
    const card = baseCard({ tags: ["react", "testing"] });
    const html = renderToStaticMarkup(createElement(Flashcard, { card, flipped: true }));

    const backIndex = html.indexOf("Answer text");
    const tagsIndex = html.indexOf("Tags:");
    const sourceIndex = html.indexOf("Source:");

    expect(backIndex).toBeGreaterThanOrEqual(0);
    expect(tagsIndex).toBeGreaterThan(backIndex);
    expect(sourceIndex).toBeGreaterThan(tagsIndex);
  });
});
