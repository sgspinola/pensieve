import type { SerializedFlashcard } from "@/app/flashcards/types";

/**
 * True-when-selected filter: a card matches if it carries at least one tag
 * in `selectedTags` (OR semantics — selecting more tags broadens the
 * session). An empty selection matches every card, mirroring how an empty
 * kinds/tags filter means "no narrowing" in items.ts's listItems.
 */
export function filterFlashcardsByTags(
  cards: SerializedFlashcard[],
  selectedTags: string[],
): SerializedFlashcard[] {
  if (selectedTags.length === 0) return cards;
  const selected = new Set(selectedTags);
  return cards.filter((card) => card.tags.some((tag) => selected.has(tag)));
}

/** Fisher-Yates shuffle; returns a new array, leaves `items` untouched. */
export function shuffleDeck<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Builds a fresh study deck: every flashcard matching the tag selection, shuffled. */
export function buildDeck(cards: SerializedFlashcard[], selectedTags: string[]): SerializedFlashcard[] {
  return shuffleDeck(filterFlashcardsByTags(cards, selectedTags));
}

export type AdvanceDirection = "next" | "prev";

/**
 * The single index-advance function shared by every input method (buttons
 * here in ticket 04a; swipe and arrow keys in ticket 04b call this exact
 * same function rather than duplicating the bounds logic). Reaching
 * `deckLength` (one past the last valid card index) is the signal the deck
 * is complete — callers should treat `index === deckLength` as "show the
 * completion screen," not as an out-of-bounds error. Never wraps: `prev` at
 * the first card and `next` at/past the end both clamp in place.
 */
export function advanceIndex(currentIndex: number, deckLength: number, direction: AdvanceDirection): number {
  if (direction === "next") return Math.min(currentIndex + 1, deckLength);
  return Math.max(currentIndex - 1, 0);
}

export type StudyKeyAction = "next" | "prev" | "flip";

/**
 * Maps a keydown event's `key` to the studying-stage shortcut it triggers,
 * or null if unbound. Space always resolves to "flip" regardless of which
 * element has focus — callers apply that globally rather than deferring to
 * a focused button's own native activation.
 */
export function resolveStudyKeyAction(key: string): StudyKeyAction | null {
  if (key === "ArrowRight") return "next";
  if (key === "ArrowLeft") return "prev";
  if (key === " ") return "flip";
  return null;
}
