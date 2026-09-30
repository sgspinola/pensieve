import { describe, expect, it } from "vitest";
import type { SerializedFlashcard } from "@/app/flashcards/types";
import { advanceIndex, buildDeck, filterFlashcardsByTags, resolveStudyKeyAction, shuffleDeck } from "./deck";

function card(id: string, tags: string[]): SerializedFlashcard {
  return {
    id,
    front: `front-${id}`,
    back: `back-${id}`,
    frontHash: `hash-${id}`,
    source: "https://example.com",
    createdBy: "creator-id",
    createdByName: "Creator",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags,
  };
}

describe("filterFlashcardsByTags", () => {
  it("matches a card carrying at least one of the selected tags (OR semantics)", () => {
    const networking = card("1", ["networking"]);
    const crypto = card("2", ["cryptography"]);
    const unrelated = card("3", ["unrelated"]);

    const matched = filterFlashcardsByTags([networking, crypto, unrelated], ["networking", "cryptography"]);

    expect(matched.map((c) => c.id).sort()).toEqual(["1", "2"]);
  });

  it("returns every card when no tags are selected", () => {
    const cards = [card("1", ["a"]), card("2", ["b"])];
    expect(filterFlashcardsByTags(cards, [])).toEqual(cards);
  });

  it("returns nothing when no card matches any selected tag", () => {
    const cards = [card("1", ["a"])];
    expect(filterFlashcardsByTags(cards, ["z"])).toEqual([]);
  });
});

describe("shuffleDeck", () => {
  it("returns a new array with exactly the same elements, none dropped or duplicated", () => {
    const cards = [card("1", []), card("2", []), card("3", []), card("4", [])];

    const shuffled = shuffleDeck(cards);

    expect(shuffled).not.toBe(cards);
    expect(shuffled).toHaveLength(cards.length);
    expect(shuffled.map((c) => c.id).sort()).toEqual(cards.map((c) => c.id).sort());
  });

  it("does not mutate the input array", () => {
    const cards = [card("1", []), card("2", [])];
    const copy = [...cards];

    shuffleDeck(cards);

    expect(cards).toEqual(copy);
  });

  it("handles an empty array", () => {
    expect(shuffleDeck([])).toEqual([]);
  });
});

describe("buildDeck", () => {
  it("filters by tags and returns every matching card exactly once", () => {
    const networking = card("1", ["networking"]);
    const crypto = card("2", ["cryptography"]);
    const unrelated = card("3", ["unrelated"]);

    const deck = buildDeck([networking, crypto, unrelated], ["networking", "cryptography"]);

    expect(deck.map((c) => c.id).sort()).toEqual(["1", "2"]);
  });
});

describe("advanceIndex", () => {
  it("moves forward by one", () => {
    expect(advanceIndex(0, 3, "next")).toBe(1);
  });

  it("moves backward by one", () => {
    expect(advanceIndex(1, 3, "prev")).toBe(0);
  });

  it("does not go below zero", () => {
    expect(advanceIndex(0, 3, "prev")).toBe(0);
  });

  it("reaches deckLength (signaling completion) from the last card", () => {
    expect(advanceIndex(2, 3, "next")).toBe(3);
  });

  it("does not advance past deckLength", () => {
    expect(advanceIndex(3, 3, "next")).toBe(3);
  });
});

describe("resolveStudyKeyAction", () => {
  it("maps ArrowRight to next", () => {
    expect(resolveStudyKeyAction("ArrowRight")).toBe("next");
  });

  it("maps ArrowLeft to prev", () => {
    expect(resolveStudyKeyAction("ArrowLeft")).toBe("prev");
  });

  it("maps the space bar to flip", () => {
    expect(resolveStudyKeyAction(" ")).toBe("flip");
  });

  it("returns null for keys with no binding", () => {
    expect(resolveStudyKeyAction("Enter")).toBeNull();
    expect(resolveStudyKeyAction("a")).toBeNull();
  });
});
