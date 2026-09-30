"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { readErrorMessage } from "@/lib/http-client";
import { MarkdownEditor } from "./MarkdownEditor";
import { ParentArticleSelect } from "./ParentArticleSelect";
import { TagsInput } from "./TagsInput";
import fieldStyles from "./form-field.module.css";
import styles from "./ItemForm.module.css";

// Wiki pages are never offered here: this radiogroup only ever renders in
// create mode with `lockKind` unset (see the `!lockKind && !isEdit` guard
// below), and `/wiki`'s own creation flow always passes `lockKind` with
// `defaultKind="page"` instead of letting someone pick it from this list.
const KIND_OPTIONS: readonly { value: "link" | "tool" | "article"; label: string }[] = [
  { value: "article", label: "Article" },
  { value: "link", label: "Link" },
  { value: "tool", label: "Tool" },
];

/** Which item this form is for: a brand-new one, or an existing one being edited. */
export type ItemFormMode = { kind: "create" } | { kind: "edit"; itemId: string };

export interface ItemFormValues {
  kind: "link" | "tool" | "article" | "page";
  url: string;
  title: string;
  description: string;
  notes: string;
  content: string;
  parentId: string | null;
  tags: string[];
}

/**
 * The request `ItemForm` submits for a given mode: `POST /api/items` to
 * create (including `kind`, since the API needs it to know which shape to
 * insert), `PATCH /api/items/[id]` to edit (never `kind` — the API rejects
 * an update that tries to change it, per `route.ts`'s own check) — same
 * endpoints `AddItemForm`/`ItemRow`'s own `handleSave` hit before this
 * ticket, just parameterized instead of duplicated. Body shape is
 * kind-varying (page: title/content/parentId; link/tool/article: url/description)
 * regardless of create vs. edit. Exported (and used by the component's own
 * submit handler, not just tests) so create-vs-edit, per-kind
 * request-building is unit-testable without rendering the component — the
 * same pure-extraction pattern as `FlashcardForm`'s `buildFlashcardRequest`.
 */
export function buildItemRequest(
  mode: ItemFormMode,
  values: ItemFormValues,
): { url: string; method: "POST" | "PATCH"; body: Record<string, unknown> } {
  const isPage = values.kind === "page";
  const kindFields = isPage
    ? { title: values.title, content: values.content, notes: values.notes, tags: values.tags, parentId: values.parentId }
    : {
        url: values.url.trim(),
        title: values.title,
        description: values.description,
        notes: values.notes,
        tags: values.tags,
      };

  return mode.kind === "create"
    ? { url: "/api/items", method: "POST", body: { kind: values.kind, ...kindFields } }
    : { url: `/api/items/${mode.itemId}`, method: "PATCH", body: kindFields };
}

/**
 * Whether `values` differs from `initialValues` — drives the edit modal's
 * unsaved-changes confirmation (ticket 07, both on an `Esc`-triggered close
 * via `Modal`'s `confirmClose` and on the form's own Cancel button).
 * Compares every field regardless of `kind` (the fields that don't apply to
 * the current kind — e.g. `url`/`description` for a page — never change
 * from their initial value since the form doesn't render inputs for them,
 * so including them here is harmless). Tag order is treated as significant
 * (there's no reorder UI, so a change in order only ever happens alongside
 * an actual add/remove) — same convention as `isFlashcardFormDirty`.
 */
export function isItemFormDirty(values: ItemFormValues, initialValues: ItemFormValues): boolean {
  return (
    values.title !== initialValues.title ||
    values.url !== initialValues.url ||
    values.description !== initialValues.description ||
    values.content !== initialValues.content ||
    values.notes !== initialValues.notes ||
    values.parentId !== initialValues.parentId ||
    values.tags.length !== initialValues.tags.length ||
    values.tags.some((tag, index) => tag !== initialValues.tags[index])
  );
}

/**
 * The Add Item page's form — and, as of ticket 07, the shared edit form too.
 * For a link/tool/article: pastes a URL, gets title/description prefilled
 * from the page's metadata (fetched server-side via /api/items/metadata)
 * while remaining fully editable. For a wiki page: no URL or metadata fetch —
 * the title and markdown `content` body are authored directly here. Tags
 * (issue 07 of the original feature) are attached the same way regardless
 * of kind.
 *
 * Two submit actions in create mode (ticket 02): the primary button saves
 * and navigates back to the workspace; the secondary button saves, clears
 * the form, and keeps the user here with a confirmation message. Both are
 * real submit buttons distinguished by the native `submitter` on the form's
 * submit event, so Enter-to-submit still defaults to the primary action.
 * Edit mode (this ticket) has no "add another" action — only Save/Cancel,
 * matching `FlashcardForm`'s equivalent rule — and neither Save nor Cancel
 * navigate; both call back into the caller (`onSaved`/`onCancel`), since
 * editing runs inside ticket 02's `Modal` rather than owning its own
 * navigation. The Kind radiogroup is always hidden in edit mode (in
 * addition to whenever `lockKind` is passed): an item's `kind` can never be
 * changed once created — `PATCH /api/items/[id]` rejects any attempt to —
 * so there's nothing to lock other than always-locked.
 *
 * Ticket 06 (of this same feature) added four optional props so `/wiki`'s
 * "New page"/"Add child page" flows can reuse this exact form rather
 * than forking it; these only ever apply in create mode and are otherwise
 * unchanged by this ticket's edit-mode addition:
 * - `defaultKind`: initial `kind` state (default `"link"`).
 * - `lockKind`: hides the Kind radiogroup and forces page authoring
 *   (default `false`) — `/wiki` only ever creates pages.
 * - `defaultParentId`: initial `parentId` state, e.g. "Add child page" on
 *   node X seeds this with `X.id` (default `null`).
 * - `onSuccess`: when provided, called with the created item instead of the
 *   default navigate-to-"/" behavior — but only for the primary ("Add item")
 *   submit. The secondary ("Add & add another") submit always stays on
 *   this form with its fields cleared; `onSuccess` is still called (with
 *   `stayOnPage: true`) so the caller can react — e.g. refresh sidebar
 *   data — without being handed control of navigation.
 *
 * Edit mode instead takes `initialValues` (the item's current field values,
 * used both to pre-fill every field and as the dirty-check baseline),
 * `onSaved` (called after a successful PATCH), and `onDirtyChange` (reports
 * live dirty state as fields change, from each field's own change handler
 * rather than an effect, so it's a plain synchronous notification — same
 * convention as `FlashcardForm`). `onCancel` is shared by both modes: in
 * create mode it's `/items/new`'s "navigate to /" fallback or `/wiki`'s
 * "close the panel" override; in edit mode it's `ItemRow`'s
 * discard-changes-aware close.
 */
export function ItemForm({
  mode,
  tagSuggestions,
  initialValues,
  defaultKind = "tool",
  lockKind = false,
  defaultParentId = null,
  onSuccess,
  onCancel,
  onSaved,
  onDirtyChange,
}: {
  mode: ItemFormMode;
  tagSuggestions: string[];
  /** Edit mode only: the item's current values to pre-fill and diff against. */
  initialValues?: ItemFormValues;
  /** Create mode only. */
  defaultKind?: "link" | "tool" | "article" | "page";
  /** Create mode only. */
  lockKind?: boolean;
  /** Create mode only. */
  defaultParentId?: string | null;
  /** Create mode only: called with the created item instead of the default navigate-to-"/" behavior. */
  onSuccess?: (item: { id: string }, options: { stayOnPage: boolean }) => void;
  /** Called by Cancel in both modes. */
  onCancel?: () => void;
  /** Edit mode only: called after a successful save. */
  onSaved?: () => void;
  /** Edit mode only: reports live dirty state as fields change. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const seed = mode.kind === "edit" ? initialValues : undefined;
  const [kind, setKind] = useState<"link" | "tool" | "article" | "page">(seed?.kind ?? defaultKind);
  const [url, setUrl] = useState(seed?.url ?? "");
  const [title, setTitle] = useState(seed?.title ?? "");
  const [description, setDescription] = useState(seed?.description ?? "");
  const [notes, setNotes] = useState(seed?.notes ?? "");
  const [content, setContent] = useState(seed?.content ?? "");
  const [parentId, setParentId] = useState<string | null>(seed?.parentId ?? defaultParentId);
  const [tags, setTags] = useState<string[]>(seed?.tags ?? []);
  const [fetchingMetadata, setFetchingMetadata] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  // Bumped after every successful create so `ParentArticleSelect` (kept
  // mounted across "Add & add another" submits, since this form clears its
  // own fields in place rather than remounting) refetches and picks up the
  // article just added — see that component's `refreshKey` doc comment.
  const [parentOptionsRefreshKey, setParentOptionsRefreshKey] = useState(0);
  const isPage = kind === "page";
  const isEdit = mode.kind === "edit";
  const editorWrapperClassName = isEdit ? styles.modalFieldEditor : undefined;
  // Same convention as `FlashcardForm`'s `idPrefix`: an edit instance's field
  // ids are scoped to the item being edited rather than the flat
  // "item-form-*" ids create mode uses. Harmless today since only one
  // `Modal` (and thus one edit-mode `ItemForm`) is ever mounted at a time
  // (`ItemsLibrary`'s single-`editingId` convention), but scoping avoids
  // relying on that invariant for id uniqueness.
  const idPrefix = mode.kind === "edit" ? `item-${mode.itemId}` : "item-form";

  function reportDirty(next: Partial<ItemFormValues>) {
    if (!isEdit || !initialValues) return;
    onDirtyChange?.(isItemFormDirty({ kind, url, title, description, notes, content, parentId, tags, ...next }, initialValues));
  }

  async function handleUrlBlur() {
    // Never clobber text the user already typed in.
    if (!url.trim() || title.trim() || description.trim()) return;

    setFetchingMetadata(true);
    try {
      const response = await fetch("/api/items/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!response.ok) return;
      const metadata = await response.json();
      if (metadata.title) setTitle(metadata.title);
      if (metadata.description) setDescription(metadata.description);
    } finally {
      setFetchingMetadata(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setConfirmation(null);
    setPending(true);

    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const stayOnPage = mode.kind === "create" && submitter?.value === "stay";

    try {
      const { url: requestUrl, method, body } = buildItemRequest(mode, {
        kind,
        url,
        title,
        description,
        notes,
        content,
        parentId,
        tags,
      });

      const response = await fetch(requestUrl, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));

      if (mode.kind === "create") {
        const { item } = await response.json();

        setUrl("");
        setTitle("");
        setDescription("");
        setNotes("");
        setContent("");
        setParentId(defaultParentId);
        setTags([]);
        setKind(defaultKind);
        setParentOptionsRefreshKey((key) => key + 1);

        if (stayOnPage) {
          setConfirmation("Item added.");
          // Stay in place with the now-cleared form above regardless of
          // whether `onSuccess` is set — "Add & add another" means add
          // another, not navigate to the one just created. `onSuccess` still
          // gets told about it (e.g. so `/wiki`'s sidebar tree can refresh to
          // show the new article) but only via the `stayOnPage` flag, never
          // as the navigate-away signal.
          if (onSuccess) {
            onSuccess(item, { stayOnPage: true });
          } else {
            // Re-fetches tagSuggestions (a server-rendered prop) so a tag just
            // created here is available for autocomplete on the next add,
            // without losing the form/confirmation state just set above.
            router.refresh();
          }
        } else if (onSuccess) {
          onSuccess(item, { stayOnPage: false });
        } else {
          router.push("/");
          router.refresh();
        }
      } else {
        onDirtyChange?.(false);
        onSaved?.();
      }
    } catch (err) {
      const fallback = mode.kind === "create" ? "Could not add item" : "Could not save changes";
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setPending(false);
    }
  }

  function handleCancel() {
    if (mode.kind === "create") {
      if (onCancel) {
        onCancel();
      } else {
        router.push("/");
      }
    } else {
      onCancel?.();
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {confirmation && <p className={styles.confirmation}>{confirmation}</p>}
      {!lockKind && !isEdit && (
        <div className={styles.fieldGroup}>
          <span className={styles.label} id="item-form-kind-label">
            Kind
          </span>
          <div className={styles.kindOptions} role="radiogroup" aria-labelledby="item-form-kind-label">
            {KIND_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={kind === option.value}
                className={
                  kind === option.value ? `${styles.kindOption} ${styles.kindOptionActive}` : styles.kindOption
                }
                onClick={() => {
                  setKind(option.value);
                  reportDirty({ kind: option.value });
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {isPage ? (
        <>
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`${idPrefix}-title`}>
              Title
            </label>
            <input
              id={`${idPrefix}-title`}
              className={fieldStyles.field}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                reportDirty({ title: event.target.value });
              }}
              required
            />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`${idPrefix}-content`}>
              Content (markdown)
            </label>
            <div className={editorWrapperClassName}>
              <MarkdownEditor
                id={`${idPrefix}-content`}
                value={content}
                onChange={(next) => {
                  setContent(next);
                  reportDirty({ content: next });
                }}
                required
              />
            </div>
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`${idPrefix}-parent`}>
              Parent page
            </label>
            <ParentArticleSelect
              id={`${idPrefix}-parent`}
              value={parentId}
              onChange={(next) => {
                setParentId(next);
                reportDirty({ parentId: next });
              }}
              excludeId={mode.kind === "edit" ? mode.itemId : undefined}
              refreshKey={parentOptionsRefreshKey}
            />
          </div>
        </>
      ) : (
        <>
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`${idPrefix}-url`}>
              URL
            </label>
            <input
              id={`${idPrefix}-url`}
              className={fieldStyles.field}
              type="url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                reportDirty({ url: event.target.value });
              }}
              onBlur={handleUrlBlur}
              required
            />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`${idPrefix}-title`}>
              Title {fetchingMetadata && "(fetching…)"}
            </label>
            <input
              id={`${idPrefix}-title`}
              className={fieldStyles.field}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                reportDirty({ title: event.target.value });
              }}
              required
            />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor={`${idPrefix}-description`}>
              Description
            </label>
            <textarea
              id={`${idPrefix}-description`}
              className={fieldStyles.field}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                reportDirty({ description: event.target.value });
              }}
            />
          </div>
        </>
      )}
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor={`${idPrefix}-notes`}>
          Notes (markdown)
        </label>
        <div className={editorWrapperClassName}>
          <MarkdownEditor
            id={`${idPrefix}-notes`}
            value={notes}
            onChange={(next) => {
              setNotes(next);
              reportDirty({ notes: next });
            }}
          />
        </div>
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
          {mode.kind === "create" ? (isPage ? "Add page" : "Add item") : "Save"}
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
