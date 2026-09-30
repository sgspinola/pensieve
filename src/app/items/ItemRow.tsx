"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown, Pencil, Trash2, User } from "lucide-react";
import { readErrorMessage } from "@/lib/http-client";
import { Modal } from "@/app/Modal";
import { DeleteArticleConfirm } from "./DeleteArticleConfirm";
import { ItemForm, type ItemFormValues } from "./ItemForm";
import { kindBadgeLabel, kindIcon } from "./kind-badge";
import { MarkdownBlock } from "./MarkdownBlock";
import { computeOverlayPosition, type OverlayOriginRect } from "@/lib/overlay-position";
import type { SerializedItem } from "./types";
import "./markdown-theme.module.css";
import styles from "./ItemRow.module.css";

// Matches MarkdownBlock.module.css's own `.clamp { max-height: 10em; }` (the
// Content block's truncation cap) — kept as one named constant here since
// Notes now computes its collapsed height in JS off this value rather than
// applying that CSS class directly (see notesCapPx above).
const NOTES_CLAMP_EMS = 10;

/**
 * One item in the Library list. Ticket 07: editing no longer expands an
 * inline block of hand-duplicated fields — clicking the edit trigger opens
 * ticket 02's `Modal`, rendering the shared `ItemForm` (edit mode) pre-filled
 * with this item's current values and kind. `isEditing`/`onEditToggle`/
 * `onChanged` are unchanged props still owned by `ItemsLibrary` (same
 * single-`editingId` convention as before this ticket) — `onEditToggle` both
 * opens the modal (edit icon click) and is what `Modal`'s own `onClose`
 * calls on an unintercepted `Esc`, and `onChanged` (which resets `editingId`
 * and calls `router.refresh()`) is passed straight through as `ItemForm`'s
 * `onSaved`, reusing the existing mutation-refresh mechanism rather than
 * patching this row's props in place. Mirrors the equivalent
 * `FlashcardForm`/`FlashcardRow` refactor from ticket 06.
 */
export function ItemRow({
  item,
  canModify,
  isAdmin,
  isEditing,
  onEditToggle,
  isExpanded,
  onExpandToggle,
  isInert,
  onChanged,
  tagSuggestions,
}: {
  item: SerializedItem;
  canModify: boolean;
  isAdmin: boolean;
  isEditing: boolean;
  onEditToggle: () => void;
  isExpanded: boolean;
  onExpandToggle: () => void;
  isInert: boolean;
  onChanged: () => void;
  tagSuggestions: string[];
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local to this row, not lifted into ItemsLibrary: only used to gate the
  // discard-unsaved-changes confirmation below, reset to false every time
  // the edit modal is (re-)opened (see handleOpenEdit) so a stale `true`
  // from a previous edit session can't linger across re-opens.
  const [dirty, setDirty] = useState(false);
  // Notes collapses/reveals independently of the card's own width-expand
  // overlay (`isExpanded` below) — mirrors FlashcardRow's `isAnswerRevealed`:
  // a local per-card toggle, animated via Motion to the content's real
  // measured height, rather than reusing the overlay toggle the way this
  // used to.
  const [isNotesRevealed, setIsNotesRevealed] = useState(false);
  // Mirrors FlashcardRow's own `useReducedMotion` read: the Motion-driven
  // notes reveal isn't covered by globals.css's blanket
  // `prefers-reduced-motion` media query the way a plain CSS transition is.
  const prefersReducedMotion = useReducedMotion();

  // Measures the notes content the same way Flashcard.tsx measures its own
  // faces (`scrollHeight` via a ref, in a layout effect so it lands before
  // paint) rather than hardcoding a collapsed height: `scrollHeight` reports
  // the content's full natural extent regardless of any `max-height`/
  // `overflow: hidden` applied elsewhere, so a note shorter than the cap
  // measures as shorter than the cap — it never gets forced to reserve the
  // cap's full height (the dead-space bug a hardcoded "10em" collapsed
  // target produced). `notesCapPx` reads the cap in real pixels off the
  // element's own computed font-size rather than assuming a fixed root size,
  // so it can't drift from NOTES_CLAMP_EMS below. `MarkdownBlock` itself is
  // always rendered `isExpanded={true}` for notes now (see below) — this
  // component owns the clamp/fade entirely via `notesCollapsedHeight` and
  // `styles.notesFade`, rather than delegating to MarkdownBlock's own
  // `.clamp`, so this ref's measurement is never itself clamped.
  const notesContentRef = useRef<HTMLDivElement>(null);
  const [notesFullHeight, setNotesFullHeight] = useState<number | null>(null);
  const [notesCapPx, setNotesCapPx] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = notesContentRef.current;
    if (!node) return;
    setNotesFullHeight(node.scrollHeight);
    setNotesCapPx(parseFloat(getComputedStyle(node).fontSize) * NOTES_CLAMP_EMS);
  }, [item.notes]);

  const isNotesTruncated = notesFullHeight !== null && notesCapPx !== null && notesFullHeight > notesCapPx;
  const notesCollapsedHeight = isNotesTruncated ? notesCapPx! : (notesFullHeight ?? undefined);
  const isPage = item.kind === "page";
  const KindIcon = kindIcon(item.kind);
  const kindLabel = kindBadgeLabel(item.kind);
  const editInitialValues: ItemFormValues = {
    kind: item.kind,
    url: item.url ?? "",
    title: item.title ?? "",
    description: item.description ?? "",
    notes: item.notes ?? "",
    content: item.content ?? "",
    parentId: item.parentId ?? null,
    tags: item.tags,
  };
  // Ticket 09: has-children articles get the promote/cascade confirmation
  // panel below instead of `window.confirm`. `null` means the panel isn't
  // showing; a number is the child count it was opened with.
  const [confirmingDeleteChildCount, setConfirmingDeleteChildCount] = useState<number | null>(null);

  // Ticket 05: expand-to-overlay. `rowRef` is the single `<li>` shared by
  // both the in-grid card and the detached overlay — the origin rect is
  // measured from it (while still in grid flow) right before expanding
  // (synchronously in the click handler below, along with resetting
  // `overlayPos`/`revealed` so a reopen never briefly shows last time's
  // stale position), then the overlay's own rendered size (now widened) is
  // re-measured once expanded and fed through ticket 04's pure
  // `computeOverlayPosition` to land it on-screen. `overlayPos` starts
  // `null` (rendered invisible, opacity 0) until that measurement lands, so
  // there's no visible jump; `revealed` then flips true a frame later so
  // the CSS opacity transition has two distinct painted frames to animate
  // between. Both effects defer their setState calls into a
  // requestAnimationFrame callback rather than calling them synchronously
  // in the effect body, consistent with this file's existing debounce
  // effect deferring its own state update into a callback.
  const rowRef = useRef<HTMLLIElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const originRectRef = useRef<OverlayOriginRect | null>(null);
  const [overlayPos, setOverlayPos] = useState<{ top: number; left: number } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const wasExpandedRef = useRef(false);

  useEffect(() => {
    if (!isExpanded) return;
    const origin = originRectRef.current;
    const node = rowRef.current;
    if (!origin || !node) return;

    function reposition() {
      if (!origin || !node) return;
      const rect = node.getBoundingClientRect();
      setOverlayPos(
        computeOverlayPosition(
          origin,
          { width: rect.width, height: rect.height },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    }

    const frame = requestAnimationFrame(reposition);
    // Re-clamp against the new viewport on resize/rotation so the overlay
    // (still anchored to the pre-expand origin rect) can't end up stranded
    // off-screen after the window shrinks or the device rotates.
    window.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", reposition);
    };
  }, [isExpanded]);

  useEffect(() => {
    if (!overlayPos) return;
    const frame = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(frame);
  }, [overlayPos]);

  // Return focus to the toggle that opened the overlay on any dismissal
  // path (backdrop click, Escape, or the toggle itself), since all three
  // ultimately flip `isExpanded` to false via the parent's `expandedId`.
  useEffect(() => {
    if (wasExpandedRef.current && !isExpanded) {
      toggleButtonRef.current?.focus();
    }
    wasExpandedRef.current = isExpanded;
  }, [isExpanded]);

  function handleToggleExpand() {
    if (!isExpanded) {
      const rect = rowRef.current?.getBoundingClientRect();
      if (rect) {
        originRectRef.current = {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        };
      }
      setOverlayPos(null);
      setRevealed(false);
    }
    onExpandToggle();
  }

  const expandIconClass = isExpanded ? `${styles.expandIcon} ${styles.expandIconOpen}` : styles.expandIcon;
  const blockIconClass = isExpanded ? `${styles.blockIcon} ${styles.expandIconOpen}` : styles.blockIcon;
  const notesIconClass = isNotesRevealed ? `${styles.expandIcon} ${styles.expandIconOpen}` : styles.expandIcon;
  const notesInnerClass =
    !isNotesRevealed && isNotesTruncated ? `${styles.notesRevealInner} ${styles.notesFade}` : styles.notesRevealInner;

  const overlayStyle: CSSProperties | undefined = isExpanded
    ? {
        top: overlayPos ? `${overlayPos.top}px` : undefined,
        left: overlayPos ? `${overlayPos.left}px` : undefined,
        opacity: revealed ? 1 : 0,
      }
    : undefined;

  function handleOpenEdit() {
    setDirty(false);
    onEditToggle();
  }

  function confirmDiscardChanges(): boolean {
    // Returning `true` intercepts the close (per Modal's `confirmClose`
    // contract) — i.e. only when the form is dirty *and* the user backs out
    // of the native "discard changes?" confirm does the close get cancelled.
    return dirty && !window.confirm("Discard unsaved changes?");
  }

  function handleCancelEdit() {
    if (confirmDiscardChanges()) return;
    onEditToggle();
  }

  async function deleteViaApi(cascade: boolean): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const url = cascade ? `/api/items/${item.id}?cascade=true` : `/api/items/${item.id}`;
      const response = await fetch(url, { method: "DELETE" });
      if (!response.ok && response.status !== 204) throw new Error(await readErrorMessage(response));
      onChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete item");
      setPending(false);
      return false;
    }
  }

  async function handleDelete() {
    if (isPage) {
      // Determine whether this page has children before deciding between
      // the unchanged `window.confirm` path (childless) and the promote/
      // cascade panel (has children) — same self-contained fetch pattern
      // `ParentArticleSelect.tsx` already uses, no new endpoint.
      let childCount = 0;
      try {
        const response = await fetch("/api/items?kind=page");
        if (response.ok) {
          const data = await response.json();
          const items = Array.isArray(data.items) ? data.items : [];
          childCount = items.filter(
            (candidate: { parentId: string | null }) => candidate.parentId === item.id,
          ).length;
        }
      } catch {
        // Network failure: fall through treating it as childless so delete
        // still works via the existing confirm+DELETE path below.
      }

      if (childCount > 0) {
        setConfirmingDeleteChildCount(childCount);
        return;
      }
    }

    if (!window.confirm(`Delete "${item.title || item.url}"?`)) return;
    await deleteViaApi(false);
  }

  return (
    <li
      ref={rowRef}
      className={isExpanded ? `${styles.row} ${styles.overlay}` : styles.row}
      style={overlayStyle}
      // While a different card is expanded, this row sits behind the
      // backdrop visually but remains in tab order by default — inert
      // removes it from tab order and interaction so a keyboard user can't
      // reach an occluded card's Edit/Delete buttons.
      inert={isInert || undefined}
    >
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.kindIcon} role="img" aria-label={kindLabel} title={kindLabel}>
            <KindIcon size={15} aria-hidden="true" />
          </span>
          <strong className={styles.title}>
            {item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer">
                {item.title || item.url}
              </a>
            ) : (
              item.title || "Untitled"
            )}
          </strong>
        </div>
        <div className={styles.iconActions}>
          <button
            ref={toggleButtonRef}
            className={styles.iconButton}
            type="button"
            onClick={handleToggleExpand}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Show less" : "Show more"}
            title={isExpanded ? "Show less" : "Show more"}
          >
            <ChevronDown size={16} className={expandIconClass} aria-hidden="true" />
          </button>
          {canModify && (
            <>
              <button
                className={styles.iconButton}
                type="button"
                onClick={handleOpenEdit}
                aria-label="Edit item"
                title="Edit item"
              >
                <Pencil size={15} aria-hidden="true" />
              </button>
              <button
                className={styles.iconButtonDanger}
                type="button"
                onClick={handleDelete}
                disabled={pending}
                aria-label="Delete item"
                title="Delete item"
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
      {item.description && <p className={styles.description}>{item.description}</p>}
      {item.content && (
        <div className={styles.block}>
          <ChevronDown size={13} className={blockIconClass} aria-hidden="true" />
          <MarkdownBlock source={item.content} isExpanded={isExpanded} />
        </div>
      )}
      {item.notes && (
        <div className={styles.notesPanel}>
          <div className={styles.notesHeader}>
            <p className={styles.notesLabel}>Notes</p>
            {/*
             * Only rendered once measurement confirms there's actually
             * something extra to reveal — a note shorter than the cap has
             * nothing left to show on click, so no dead toggle affordance.
             */}
            {isNotesTruncated && (
              <button
                type="button"
                className={styles.notesToggle}
                onClick={() => setIsNotesRevealed((current) => !current)}
                aria-expanded={isNotesRevealed}
                aria-label={isNotesRevealed ? "Hide notes" : "Show notes"}
                title={isNotesRevealed ? "Hide notes" : "Show notes"}
              >
                <ChevronDown size={13} className={notesIconClass} aria-hidden="true" />
              </button>
            )}
          </div>
          {/*
           * Unlike FlashcardRow.tsx's `.answerRevealInner` (fully hidden
           * while collapsed), collapsed Notes stay partially visible — a
           * preview capped at `notesCollapsedHeight` (measured above; the
           * cap only applies once the note is actually taller than it, so a
           * short note never reserves dead space) with a bottom fade
           * (`styles.notesFade`, applied only while collapsed and
           * truncated). `MarkdownBlock` is always `isExpanded={true}` here —
           * this component owns the clamp itself now, so `notesContentRef`'s
           * `scrollHeight` measurement is never affected by MarkdownBlock's
           * own `.clamp`. No `opacity` animation: the preview should read as
           * legible text fading to a gradient, not a dimmed block.
           */}
          <motion.div
            className={notesInnerClass}
            initial={false}
            animate={{ height: isNotesRevealed ? "auto" : (notesCollapsedHeight ?? "auto") }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.18, ease: "easeOut" }}
          >
            <div ref={notesContentRef}>
              <MarkdownBlock source={item.notes} isExpanded={true} />
            </div>
          </motion.div>
        </div>
      )}
      <div className={styles.footer}>
        {item.tags.length > 0 && (
          <p className={styles.tags}>
            Tags:{" "}
            <span className={styles.tagList}>
              {item.tags.map((tag) => (
                <span key={tag} className={styles.tagChip}>
                  {tag}
                </span>
              ))}
            </span>
          </p>
        )}
        <p className={styles.meta}>
          <User size={12} className={styles.metaIcon} aria-hidden="true" />
          Added by {item.createdByName}
        </p>
      </div>

      {confirmingDeleteChildCount !== null && (
        <DeleteArticleConfirm
          childCount={confirmingDeleteChildCount}
          isAdmin={isAdmin}
          pending={pending}
          onPromote={async () => {
            if (await deleteViaApi(false)) setConfirmingDeleteChildCount(null);
          }}
          onCascade={async () => {
            if (await deleteViaApi(true)) setConfirmingDeleteChildCount(null);
          }}
          onCancel={() => setConfirmingDeleteChildCount(null)}
        />
      )}

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {isEditing && (
        <Modal
          open
          onClose={onEditToggle}
          confirmClose={confirmDiscardChanges}
          ariaLabelledBy={`edit-item-${item.id}-heading`}
        >
          <h2 id={`edit-item-${item.id}-heading`} className={styles.modalHeading}>
            Edit item
          </h2>
          <ItemForm
            mode={{ kind: "edit", itemId: item.id }}
            initialValues={editInitialValues}
            tagSuggestions={tagSuggestions}
            onDirtyChange={setDirty}
            onSaved={onChanged}
            onCancel={handleCancelEdit}
          />
        </Modal>
      )}
    </li>
  );
}
