"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { handleCloseButtonClick, handleDialogCancel, syncDialogOpenState } from "./modal-behavior";
import styles from "./Modal.module.css";

/**
 * Ticket 02: generic, reusable modal built on the native `<dialog>` element
 * — no dialog library, since `<dialog>` already provides focus trapping,
 * top-layer stacking, and `Esc`-to-close for free. Pure infrastructure with
 * no consumer wired up yet (tickets 06/07 adopt it for flashcard/item
 * editing); this component has no page-specific logic.
 *
 * Fully controlled, mirroring this repo's `TagFilterInput` convention: the
 * caller owns `open` state and passes it in, rather than the component
 * exposing an imperative open/close handle. `onClose` is called whenever
 * the dialog finishes closing natively (an unintercepted `Esc`) — wire it to
 * whatever sets your `open` state to `false`. A consumer's own Cancel/close
 * control (rendered among `children`) closes the dialog the same way, by
 * flipping that same `open` state; the dialog also fires its native `close`
 * event in that case and calls `onClose` again, which is harmless since
 * setting already-false state to `false` again is a no-op.
 *
 * The native light-dismiss-on-backdrop-click behavior is deliberately left
 * unimplemented rather than "suppressed": a bare `<dialog>` opened via
 * `showModal()` does not close on a backdrop click by default (that only
 * happens if you add a click handler for it, e.g. checking
 * `event.target === dialogElement`), so simply never adding such a handler
 * is sufficient. This is real click/browser behavior this repo's Vitest
 * suite (Node, no jsdom) can't exercise directly, so it's covered by manual
 * verification through a real browser instead — see `modal-behavior.test.ts`
 * for what is covered at the unit level (the imperative open/close sync and
 * the `Esc`/`confirmClose` interception logic).
 */
export function Modal({
  open,
  onClose,
  confirmClose,
  showCloseButton,
  children,
  className,
  ariaLabel,
  ariaLabelledBy,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Optional "confirm before close" predicate for a consumer to guard a
   * dirty/unsaved-changes state. Returning `true` intercepts and cancels an
   * `Esc`-triggered close (e.g. so the consumer can show its own "Discard
   * unsaved changes?" confirmation first); returning `false`/`undefined`
   * lets the close proceed.
   */
  confirmClose?: () => boolean;
  /**
   * Opt-in "×" control rendered in the dialog's top-right corner. Omitted
   * (the default) or `false` renders no such control, unchanged from before
   * this prop existed — existing consumers (e.g. the item-edit dialog) see
   * no difference. When true, activating it runs through the same
   * `confirmClose` guard as an Esc press (see `handleCloseButtonClick`).
   */
  showCloseButton?: boolean;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    syncDialogOpenState(dialog, open);
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const onCancel = (event: Event) => handleDialogCancel(event, confirmClose);
    // Fires once a close actually completes — whether that's an
    // unintercepted `Esc` (native `cancel` -> default close) or the dialog
    // being closed imperatively by `syncDialogOpenState` above in response
    // to the consumer's own `open` state going to `false`.
    const onNativeClose = () => onClose();

    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onNativeClose);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onNativeClose);
    };
  }, [confirmClose, onClose]);

  return (
    <dialog
      ref={dialogRef}
      className={[styles.dialog, className].filter(Boolean).join(" ")}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      // Deliberately no onClick/onMouseDown handler here: that's exactly
      // the light-dismiss-on-backdrop-click behavior this component must
      // suppress (see the class doc comment above) — a bare <dialog> only
      // gains that behavior if you add such a handler yourself.
    >
      <div className={styles.content}>
        {showCloseButton && (
          <button
            type="button"
            className={styles.closeButton}
            onClick={() => handleCloseButtonClick(onClose, confirmClose)}
            aria-label="Close"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
        {children}
      </div>
    </dialog>
  );
}
