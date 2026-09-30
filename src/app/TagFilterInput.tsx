"use client";

import type { CSSProperties, ReactNode } from "react";
import { filterTagsByQuery } from "@/app/flashcards/study/tag-filter";
import styles from "./TagFilterInput.module.css";

/**
 * Live tag-search box: a search input labeled "Filter tags" (via `aria-label`
 * + matching `placeholder`, not a visible `<label>` — see `TagFilterInput.module.css`),
 * a clear ("×") control, the blinking `.cursorCue` caret standing in for the real one, and
 * a "No tags match '…'" empty state — shared by any page that lets a user
 * narrow a tag list by typing (today the study session's tag-selection
 * screen; the Library and flashcards list pages adopt it next).
 *
 * Stays fully controlled and hook-free: the caller owns the query state and
 * passes it in via `value`/`onChange`, so this is a pure function of props
 * to markup. Filtering (`filterTagsByQuery`) happens here so every caller
 * gets the exact same case-insensitive substring match, but rendering the
 * matched tags themselves (a `TagCloud`, or anything else) is left entirely
 * to the caller via `children` — this component has no opinion on
 * selection state or how a tag chip looks.
 *
 * `className` is the *entire* class for the field wrapper, and is required:
 * every caller is expected to reach the shared base layout via CSS Modules
 * `composes` (see `StudySession.module.css`'s `.filterField`, which composes
 * `filterField` from this component's own module and adds the study page's
 * centered 20rem box) rather than this component appending its own base
 * class on top of what the caller already composed in.
 */
export function TagFilterInput({
  id,
  tags,
  value,
  onChange,
  className,
  children,
}: {
  id: string;
  tags: string[];
  value: string;
  onChange: (value: string) => void;
  className: string;
  children: (visibleTags: string[]) => ReactNode;
}) {
  const visibleTags = filterTagsByQuery(tags, value);

  return (
    <>
      <div className={className}>
        <div className={styles.filterInputWrap} style={{ "--char-count": value.length } as CSSProperties}>
          <input
            id={id}
            type="search"
            className={styles.field}
            aria-label="Filter tags"
            placeholder="Filter tags"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          <span className={styles.cursorCue} aria-hidden="true" />
          {value && (
            <button
              type="button"
              className={styles.clearFilterButton}
              aria-label="Clear tag filter"
              onClick={() => onChange("")}
            >
              ×
            </button>
          )}
        </div>
      </div>
      {visibleTags.length === 0 ? (
        <p className={styles.empty}>No tags match &apos;{value}&apos;.</p>
      ) : (
        children(visibleTags)
      )}
    </>
  );
}
