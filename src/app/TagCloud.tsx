"use client";

import styles from "./TagCloud.module.css";

/**
 * The pill-style tag chip cloud, shared by the study page's tag-selection
 * screen and the main page's tag filter row so the two can't drift apart.
 */
export function TagCloud({
  tags,
  selectedTags,
  onToggle,
  ariaLabel,
}: {
  tags: string[];
  selectedTags: string[];
  onToggle: (tag: string) => void;
  ariaLabel?: string;
}) {
  return (
    <ul className={styles.tagList} {...(ariaLabel ? { role: "group", "aria-label": ariaLabel } : {})}>
      {tags.map((tag) => {
        const isSelected = selectedTags.includes(tag);
        return (
          <li key={tag}>
            <button
              type="button"
              className={isSelected ? `${styles.tagChip} ${styles.tagChipSelected}` : styles.tagChip}
              aria-pressed={isSelected}
              onClick={() => onToggle(tag)}
            >
              {tag}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
