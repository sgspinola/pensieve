"use client";

import { useState, type KeyboardEvent } from "react";
import fieldStyles from "./form-field.module.css";
import styles from "./TagsInput.module.css";

/**
 * Freeform tag entry: existing tags render as removable chips, and the text
 * field autocompletes against `suggestions` (every tag name that already
 * exists in the workspace) via a native <datalist> — no custom dropdown
 * needed for the browser to suggest matches as the user types. Enter or a
 * trailing comma commits the current text as a new tag.
 */
export function TagsInput({
  id,
  tags,
  onChange,
  suggestions,
}: {
  id: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
}) {
  const [draft, setDraft] = useState("");
  const datalistId = `${id}-suggestions`;

  function commitDraft() {
    const candidate = draft.trim();
    setDraft("");
    if (!candidate) return;
    if (tags.some((tag) => tag.toLowerCase() === candidate.toLowerCase())) return;
    onChange([...tags, candidate]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitDraft();
    } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  return (
    <div>
      {tags.length > 0 && (
        <ul className={styles.tagList}>
          {tags.map((tag) => (
            <li key={tag} className={styles.tagChip}>
              {tag}
              <button
                className={styles.removeButton}
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={`Remove tag ${tag}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        className={fieldStyles.field}
        list={datalistId}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commitDraft}
        placeholder="Add a tag and press Enter"
      />
      <datalist id={datalistId}>
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </div>
  );
}
