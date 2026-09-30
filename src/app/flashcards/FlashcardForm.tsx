"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { readErrorMessage } from "@/lib/http-client";
import { MarkdownEditor } from "@/app/items/MarkdownEditor";
import { TagsInput } from "@/app/items/TagsInput";
import { hasTags, TAGS_REQUIRED_ERROR } from "@/services/tags/validation";
import fieldStyles from "@/app/items/form-field.module.css";
import styles from "./FlashcardForm.module.css";

/** Which flashcard this form is for: a brand-new one, or an existing one being edited. */
export type FlashcardFormMode = { kind: "create" } | { kind: "edit"; flashcardId: string };

export interface FlashcardFormValues {
  front: string;
  back: string;
  // Free-form citation text (ticket 04) — required, shown alongside the
  // answer during study instead of being inlined into `back`.
  source: string;
  tags: string[];
}

/**
 * The request `FlashcardForm` submits for a given mode: `POST /api/flashcards`
 * to create, `PATCH /api/flashcards/[id]` to edit — same endpoints
 * `AddFlashcardForm`/`FlashcardRow`'s own `handleSave` hit before this
 * ticket, just parameterized instead of duplicated. Exported (and used by
 * the component's own submit handler, not just tests) so create-vs-edit
 * request-building is unit-testable without rendering the component — the
 * same pure-extraction pattern as `FlashcardsManager`'s `buildLoadMoreQuery`.
 */
export function buildFlashcardRequest(
  mode: FlashcardFormMode,
  values: FlashcardFormValues,
): { url: string; method: "POST" | "PATCH"; body: FlashcardFormValues } {
  return mode.kind === "create"
    ? { url: "/api/flashcards", method: "POST", body: values }
    : { url: `/api/flashcards/${mode.flashcardId}`, method: "PATCH", body: values };
}

/**
 * Whether `values` differs from `initialValues` — drives the edit modal's
 * unsaved-changes confirmation (ticket 06, both on an `Esc`-triggered close
 * via `Modal`'s `confirmClose` and on the form's own Cancel button). Tag
 * order is treated as significant (there's no reorder UI, so a change in
 * order only ever happens alongside an actual add/remove).
 */
export function isFlashcardFormDirty(values: FlashcardFormValues, initialValues: FlashcardFormValues): boolean {
  return (
    values.front !== initialValues.front ||
    values.back !== initialValues.back ||
    values.source !== initialValues.source ||
    values.tags.length !== initialValues.tags.length ||
    values.tags.some((tag, index) => tag !== initialValues.tags[index])
  );
}

const EMPTY_VALUES: FlashcardFormValues = { front: "", back: "", source: "", tags: [] };

/** The inline error shown when Save/Add is clicked with zero tags (ticket 04). */
export { TAGS_REQUIRED_ERROR };

/**
 * Save-time validation (ticket 04: mandatory tags): a flashcard must carry
 * at least one tag, but `TagsInput` itself never blocks removing a chip
 * (including a card's last remaining one) — the block happens here, at
 * submit, not by restricting the chip-removal UI. Returns the message to
 * show inline (mirroring the existing `error`/`setError` pattern) or `null`
 * when `values` is valid. Exported and called from `handleSubmit` before
 * any `fetch`, so an empty-tags submit never makes a round trip just to get
 * the same rejection back as a 400. The check itself (`hasTags`) is shared
 * with createFlashcard/updateFlashcard/the frontmatter import — see
 * src/services/tags/validation.ts.
 */
export function validateFlashcardFormValues(values: FlashcardFormValues): string | null {
  return hasTags(values.tags) ? null : TAGS_REQUIRED_ERROR;
}

/**
 * Front/Back (via `MarkdownEditor`) + Tags (via `TagsInput`) fields, shared
 * by `/flashcards/new` (`mode: { kind: "create" }`) and the ticket-06 edit
 * modal (`mode: { kind: "edit", flashcardId }`) — previously duplicated
 * between `AddFlashcardForm` and `FlashcardRow`'s own inline edit block.
 *
 * Create mode keeps `AddFlashcardForm`'s original two-submit-action
 * convention (primary "Add flashcard" navigates to `/flashcards`; secondary
 * "Add & add another" clears the form and stays, both distinguished via the
 * submit event's native `submitter`) and a Cancel that navigates back.
 * Edit mode has no "add another" action (only Save/Cancel, per spec), and
 * neither Save nor Cancel navigate — both call back into the caller
 * (`onSaved`/`onCancel`), since editing runs inside ticket 02's `Modal`
 * rather than owning its own navigation. `onDirtyChange` (edit mode only)
 * reports whenever the live field values start/stop differing from
 * `initialValues`, so the caller (`FlashcardRow`) can gate a discard-changes
 * confirmation on both `Modal`'s `confirmClose` (Esc) and this form's own
 * Cancel button — called from the change handlers directly rather than an
 * effect, so it's a plain synchronous notification, not a state-sync effect.
 */
export function FlashcardForm({
  mode,
  initialValues = EMPTY_VALUES,
  tagSuggestions,
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  mode: FlashcardFormMode;
  initialValues?: FlashcardFormValues;
  tagSuggestions: string[];
  /** Edit mode: called after a successful save. Ignored in create mode. */
  onSaved?: () => void;
  /** Edit mode: called when Cancel is clicked. Ignored in create mode. */
  onCancel?: () => void;
  /** Edit mode only: reports live dirty state as fields change. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [front, setFront] = useState(initialValues.front);
  const [back, setBack] = useState(initialValues.back);
  const [source, setSource] = useState(initialValues.source);
  const [tags, setTags] = useState(initialValues.tags);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const idPrefix = mode.kind === "edit" ? `flashcard-${mode.flashcardId}` : "flashcard";

  function reportDirty(next: Partial<FlashcardFormValues>) {
    onDirtyChange?.(isFlashcardFormDirty({ front, back, source, tags, ...next }, initialValues));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setConfirmation(null);

    const validationError = validateFlashcardFormValues({ front, back, source, tags });
    if (validationError) {
      setError(validationError);
      return;
    }

    setPending(true);

    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const stayOnPage = mode.kind === "create" && submitter?.value === "stay";

    try {
      const { url, method, body } = buildFlashcardRequest(mode, { front, back, source, tags });
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));

      if (mode.kind === "create") {
        setFront("");
        setBack("");
        setSource("");
        setTags([]);

        if (stayOnPage) {
          setConfirmation("Flashcard added.");
          // Re-fetches tagSuggestions (a server-rendered prop) so a tag just
          // created here is available for autocomplete on the next add,
          // without losing the form/confirmation state just set above.
          router.refresh();
        } else {
          router.push("/flashcards");
          router.refresh();
        }
      } else {
        onDirtyChange?.(false);
        onSaved?.();
      }
    } catch (err) {
      const fallback = mode.kind === "create" ? "Could not add flashcard" : "Could not save changes";
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setPending(false);
    }
  }

  function handleCancel() {
    if (mode.kind === "create") {
      router.push("/flashcards");
    } else {
      onCancel?.();
    }
  }

  const editorWrapperClassName = mode.kind === "edit" ? styles.modalFieldEditor : undefined;

  return (
    <form onSubmit={handleSubmit}>
      {confirmation && <p className={styles.confirmation}>{confirmation}</p>}
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor={`${idPrefix}-front`}>
          Question (markdown)
        </label>
        <div className={editorWrapperClassName}>
          <MarkdownEditor
            id={`${idPrefix}-front`}
            value={front}
            onChange={(next) => {
              setFront(next);
              reportDirty({ front: next });
            }}
            required
          />
        </div>
      </div>
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor={`${idPrefix}-back`}>
          Answer (markdown)
        </label>
        <div className={editorWrapperClassName}>
          <MarkdownEditor
            id={`${idPrefix}-back`}
            value={back}
            onChange={(next) => {
              setBack(next);
              reportDirty({ back: next });
            }}
            required
          />
        </div>
      </div>
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor={`${idPrefix}-source`}>
          Source
        </label>
        <input
          id={`${idPrefix}-source`}
          className={fieldStyles.field}
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            reportDirty({ source: event.target.value });
          }}
          required
        />
      </div>
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor={`${idPrefix}-tags`}>
          Tags
        </label>
        <TagsInput
          id={`${idPrefix}-tags`}
          tags={tags}
          onChange={(next) => {
            setTags(next);
            reportDirty({ tags: next });
          }}
          suggestions={tagSuggestions}
        />
      </div>
      <div className={styles.actions}>
        <button className={styles.buttonSecondary} type="button" onClick={handleCancel} disabled={pending}>
          Cancel
        </button>
        {mode.kind === "create" && (
          <button className={styles.buttonSecondary} type="submit" value="stay" disabled={pending}>
            Add &amp; add another
          </button>
        )}
        <button className={styles.button} type="submit" value="navigate" disabled={pending}>
          {mode.kind === "create" ? "Add flashcard" : "Save"}
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </form>
  );
}
