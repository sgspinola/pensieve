"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown, ChevronUp, Pencil, Trash2, User } from "lucide-react";
import { readErrorMessage } from "@/lib/http-client";
import { computeOverlayPosition, type OverlayOriginRect } from "@/lib/overlay-position";
import type { SessionUser } from "@/services/auth/session";
import { canDeleteFlashcard } from "@/services/flashcards/flashcards";
import { Modal } from "@/app/Modal";
import { MarkdownBlock } from "@/app/items/MarkdownBlock";
import "@/app/items/markdown-theme.module.css";
import { FlashcardForm } from "./FlashcardForm";
import { SourceCitation } from "./SourceCitation";
import type { SerializedFlashcard } from "./types";
import styles from "./FlashcardRow.module.css";

/**
 * One flashcard in the management list. Front/back are always rendered as
 * Markdown (never raw source, ticket 03) via the shared `MarkdownBlock`. A
 * delete control renders for the flashcard's own creator or an admin
 * (canDeleteFlashcard, same rule as items.ts's canModifyItem).
 *
 * Ticket 06: editing no longer expands an inline block of hand-duplicated
 * fields — clicking the edit trigger opens ticket 02's `Modal`, rendering
 * the shared `FlashcardForm` (edit mode) pre-filled with this flashcard's
 * current values. `isEditing`/`onEditToggle`/`onChanged` are unchanged
 * props still owned by `FlashcardsManager` (same single-`editingId`
 * convention as before this ticket) — `onEditToggle` both opens the modal
 * (edit icon click) and is what `Modal`'s own `onClose` calls on an
 * unintercepted `Esc`, and `onChanged` (which resets `editingId` and calls
 * `router.refresh()`) is passed straight through as `FlashcardForm`'s
 * `onSaved`, reusing ticket 04's existing mutation-refresh mechanism rather
 * than patching this row's props in place.
 *
 * Ticket 01: the Answer collapses/reveals independently per card via its own
 * `isAnswerRevealed` state (never lifted to `FlashcardsManager` — no other
 * card or feature needs to read or coordinate it), reusing `MarkdownBlock`'s
 * existing `isExpanded` prop rather than introducing a second truncation
 * mechanism. The Question stays hardcoded `isExpanded={true}`, unaffected.
 *
 * Ticket 02: width-expand-to-overlay, mirroring `ItemRow`'s own
 * `isExpanded`/`onExpandToggle`/`isInert` props (owned by `FlashcardsManager`,
 * same single-`expandedId` convention as `ItemsLibrary`) and its
 * origin-rect-then-`computeOverlayPosition` positioning approach verbatim —
 * see `ItemRow.tsx`'s doc comment for the full mechanism. Deliberately
 * independent of ticket 01's `isAnswerRevealed`: expanding width never
 * touches it, and it's read directly by the Answer's own `MarkdownBlock`
 * regardless of which overlay state this card is in.
 */
export function FlashcardRow({
  flashcard,
  currentUser,
  isEditing,
  onEditToggle,
  isExpanded,
  onExpandToggle,
  isInert,
  onChanged,
  tagSuggestions,
}: {
  flashcard: SerializedFlashcard;
  currentUser: SessionUser;
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
  // Local to this row, not lifted into FlashcardsManager: only used to gate
  // the discard-unsaved-changes confirmation below, reset to false every
  // time the edit modal is (re-)opened (see handleOpenEdit) so a stale
  // `true` from a previous edit session can't linger across re-opens.
  const [dirty, setDirty] = useState(false);
  // Ticket 01: collapsed by default, toggled independently per card — see
  // the class doc comment above.
  const [isAnswerRevealed, setIsAnswerRevealed] = useState(false);
  // Motion-driven answer reveal: `useReducedMotion` mirrors the
  // `prefers-reduced-motion` accessibility affordance the old CSS
  // `grid-template-rows` transition got for free from globals.css's blanket
  // media-query rule — that rule only ever silenced CSS transitions, not a
  // JS-driven Motion animation, so it has to be read explicitly here and
  // collapsed to an instant (0-duration) transition.
  const prefersReducedMotion = useReducedMotion();

  const canDelete = canDeleteFlashcard(currentUser, flashcard);

  // Ticket 02: expand-to-overlay, verbatim mechanism from ItemRow.tsx — see
  // its doc comment for why each ref/effect exists.
  const rowRef = useRef<HTMLLIElement>(null);
  const expandToggleRef = useRef<HTMLButtonElement>(null);
  const originRectRef = useRef<OverlayOriginRect | null>(null);
  const [overlayPos, setOverlayPos] = useState<{ top: number; left: number } | null>(null);
  const [overlayRevealed, setOverlayRevealed] = useState(false);
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
    window.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", reposition);
    };
  }, [isExpanded]);

  useEffect(() => {
    if (!overlayPos) return;
    const frame = requestAnimationFrame(() => setOverlayRevealed(true));
    return () => cancelAnimationFrame(frame);
  }, [overlayPos]);

  // Return focus to the toggle that opened the overlay on any dismissal
  // path, mirroring ItemRow.tsx.
  useEffect(() => {
    if (wasExpandedRef.current && !isExpanded) {
      expandToggleRef.current?.focus();
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
      setOverlayRevealed(false);
    }
    onExpandToggle();
  }

  const expandIconClass = isExpanded ? `${styles.expandIcon} ${styles.expandIconOpen}` : styles.expandIcon;

  const overlayStyle: CSSProperties | undefined = isExpanded
    ? {
        top: overlayPos ? `${overlayPos.top}px` : undefined,
        left: overlayPos ? `${overlayPos.left}px` : undefined,
        opacity: overlayRevealed ? 1 : 0,
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

  async function handleDelete() {
    if (!window.confirm("Delete this flashcard?")) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/flashcards/${flashcard.id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 204) throw new Error(await readErrorMessage(response));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete flashcard");
      setPending(false);
    }
  }

  return (
    <li
      ref={rowRef}
      className={isExpanded ? `${styles.row} ${styles.overlay}` : styles.row}
      style={overlayStyle}
      // While a different card is expanded, this row sits behind the
      // backdrop visually but remains in tab order by default — inert
      // removes it from tab order and interaction, mirroring ItemRow.tsx.
      inert={isInert || undefined}
    >
      <div className={styles.header}>
        <span className={styles.meta}>
          <User size={12} className={styles.metaIcon} aria-hidden="true" />
          Added by {flashcard.createdByName}
        </span>
        <div className={styles.iconActions}>
          <button
            ref={expandToggleRef}
            className={styles.iconButton}
            type="button"
            onClick={handleToggleExpand}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Collapse flashcard" : "Expand flashcard"}
            title={isExpanded ? "Collapse flashcard" : "Expand flashcard"}
          >
            <ChevronDown size={16} className={expandIconClass} aria-hidden="true" />
          </button>
          <button
            className={styles.iconButton}
            type="button"
            onClick={handleOpenEdit}
            aria-label="Edit flashcard"
            title="Edit flashcard"
          >
            <Pencil size={15} aria-hidden="true" />
          </button>
          {canDelete && (
            <button
              className={styles.iconButtonDanger}
              type="button"
              onClick={handleDelete}
              disabled={pending}
              aria-label="Delete flashcard"
              title="Delete flashcard"
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.blockLabel}>Question</span>
        <MarkdownBlock source={flashcard.front} isExpanded={true} />
      </div>
      <div className={styles.block}>
        <div className={styles.blockHeader}>
          <span className={styles.blockLabel}>Answer</span>
          <button
            type="button"
            className={styles.revealToggle}
            onClick={() => setIsAnswerRevealed((current) => !current)}
            aria-expanded={isAnswerRevealed}
            aria-label={isAnswerRevealed ? "Hide answer" : "Show answer"}
            title={isAnswerRevealed ? "Hide answer" : "Show answer"}
          >
            {isAnswerRevealed ? (
              <ChevronUp size={14} aria-hidden="true" />
            ) : (
              <ChevronDown size={14} aria-hidden="true" />
            )}
          </button>
        </div>
        {/*
         * Ticket 02 (motion): height/opacity are the only per-frame animated
         * values here — everything static (overflow clipping, box layout)
         * stays in FlashcardRow.module.css's `.answerRevealInner` rule.
         * `animate`'s `height: "auto"` target is Motion's built-in
         * measure-then-interpolate handling for this exact "expand to
         * content's real height" case (see .module.css's comment on
         * `.answerRevealInner` for why this node must itself size down to a
         * real 0px, not merely fade out — e2e's `not.toBeVisible()` check on
         * it relies on that). `initial={false}` skips animating on first
         * mount/SSR — the collapsed-by-default state renders directly.
         */}
        <motion.div
          className={styles.answerRevealInner}
          initial={false}
          animate={{ height: isAnswerRevealed ? "auto" : 0, opacity: isAnswerRevealed ? 1 : 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.18, ease: "easeOut" }}
        >
          <MarkdownBlock source={flashcard.back} isExpanded={isAnswerRevealed} />
        </motion.div>
      </div>
      <div className={styles.footer}>
        {flashcard.tags.length > 0 && (
          <p className={styles.tags}>
            Tags:{" "}
            <span className={styles.tagList}>
              {flashcard.tags.map((tag) => (
                <span key={tag} className={styles.tagChip}>
                  {tag}
                </span>
              ))}
            </span>
          </p>
        )}
        <SourceCitation source={flashcard.source} className={styles.meta} iconClassName={styles.metaIcon} />
      </div>
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
          showCloseButton
          ariaLabelledBy={`edit-flashcard-${flashcard.id}-heading`}
        >
          <h2 id={`edit-flashcard-${flashcard.id}-heading`} className={styles.modalHeading}>
            Edit flashcard
          </h2>
          <FlashcardForm
            mode={{ kind: "edit", flashcardId: flashcard.id }}
            initialValues={{ front: flashcard.front, back: flashcard.back, source: flashcard.source, tags: flashcard.tags }}
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
