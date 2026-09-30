import { useState } from "react";

/**
 * Tracks whether `value` just transitioned from `emptyValue` to a real value
 * for the first time — used to let a Motion `transition` snap that one
 * change into place instead of visibly animating from a placeholder, while
 * every later change still animates normally (see Flashcard.tsx's
 * `cardHeight`/StudySession.tsx's `currentCardHeight` usages).
 *
 * Uses React's "storing information from previous renders" pattern
 * (https://react.dev/reference/react/useState#storing-information-from-previous-renders) —
 * calling `setState` during render, not in an effect or via a ref (which
 * this repo's React Compiler lint config disallows reading during render) —
 * so the transition is detected on the very same render `value` changes,
 * before paint. `isFirst` must itself be state, not a plain expression
 * derived from the tracked previous value: calling setState during render
 * makes React immediately re-run the component with the previous-value
 * state already caught up, so a same-render expression comparing them would
 * always read as "not first"; only a value explicitly stored while they
 * still differed survives into the settled render.
 *
 * Returns `[isFirst, reset]` — call `reset()` (e.g. from an event handler
 * that starts a fresh sequence, like restarting a study session) when a
 * later real value should again be treated as the first one, since this
 * hook's own state lives on its calling component and won't naturally reset
 * just because some other, unrelated part of the tree remounts.
 */
export function useFirstRealValue<T>(value: T, emptyValue: T): [isFirst: boolean, reset: () => void] {
  const [prevValue, setPrevValue] = useState(value);
  const [isFirst, setIsFirst] = useState(false);
  if (value !== prevValue) {
    setIsFirst(prevValue === emptyValue && value !== emptyValue);
    setPrevValue(value);
  }
  return [isFirst, () => setPrevValue(emptyValue)];
}
