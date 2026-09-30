/**
 * Minimal shape of the native `<dialog>` API this module drives — duck-typed
 * rather than `HTMLDialogElement` so `syncDialogOpenState` is unit-testable
 * with a plain object instead of a real DOM node (this repo's Vitest suite
 * runs in a plain Node environment with no jsdom; see `Modal.tsx` for where
 * this plugs into an actual dialog ref, and this repo's `overlay-position.ts`
 * for the same pure-logic-extraction pattern applied to DOM measurements).
 */
export interface DialogControls {
  open: boolean;
  showModal: () => void;
  close: () => void;
}

/**
 * Native `<dialog>` only becomes an actual focus-trapping, `::backdrop`-
 * rendering modal when opened via `showModal()` — toggling its `open`
 * attribute alone (e.g. binding a boolean prop straight to the attribute)
 * renders a plain, non-modal, block-level element instead. So a controlled
 * boolean `open` prop has to be translated into an imperative call here,
 * made only on the transition: calling `showModal()` on an already-open
 * dialog (or `close()` on an already-closed one) throws `InvalidStateError`
 * in a real browser, and this guard is what makes the call idempotent.
 */
export function syncDialogOpenState(dialog: DialogControls, open: boolean): void {
  if (open && !dialog.open) {
    dialog.showModal();
  } else if (!open && dialog.open) {
    dialog.close();
  }
}

/**
 * A native `cancel` event fires on an open `<dialog>` when the user presses
 * Esc (or triggers another platform close-request), just before the default
 * action closes it. Calling `event.preventDefault()` stops that default
 * close — used here so a consumer-supplied `confirmClose` predicate (e.g.
 * "are there unsaved changes?") can intercept an Esc press and keep the
 * dialog open, typically to show its own discard-changes confirmation
 * before deciding whether to actually close.
 */
export function handleDialogCancel(event: { preventDefault: () => void }, confirmClose?: () => boolean): void {
  if (confirmClose?.()) {
    event.preventDefault();
  }
}

/**
 * Guard for `Modal`'s opt-in close ("×") button — routes it through the same
 * `confirmClose` predicate as an Esc press (see `handleDialogCancel` above),
 * just via direct function calls instead of a native cancelable event: no
 * `preventDefault()` to call, so a truthy `confirmClose()` simply skips
 * calling `onClose()` instead of stopping the dialog's own default action.
 */
export function handleCloseButtonClick(onClose: () => void, confirmClose?: () => boolean): void {
  if (confirmClose?.()) return;
  onClose();
}
