import { describe, expect, it, vi } from "vitest";
import { handleCloseButtonClick, handleDialogCancel, syncDialogOpenState } from "./modal-behavior";

describe("syncDialogOpenState", () => {
  it("calls showModal() when the desired state is open but the dialog isn't yet", () => {
    const dialog = { open: false, showModal: vi.fn(), close: vi.fn() };

    syncDialogOpenState(dialog, true);

    expect(dialog.showModal).toHaveBeenCalledOnce();
    expect(dialog.close).not.toHaveBeenCalled();
  });

  it("does not call showModal() again if the dialog is already open", () => {
    const dialog = { open: true, showModal: vi.fn(), close: vi.fn() };

    syncDialogOpenState(dialog, true);

    expect(dialog.showModal).not.toHaveBeenCalled();
  });

  it("calls close() when the desired state is closed but the dialog is still open", () => {
    const dialog = { open: true, showModal: vi.fn(), close: vi.fn() };

    syncDialogOpenState(dialog, false);

    expect(dialog.close).toHaveBeenCalledOnce();
    expect(dialog.showModal).not.toHaveBeenCalled();
  });

  it("does not call close() again if the dialog is already closed", () => {
    const dialog = { open: false, showModal: vi.fn(), close: vi.fn() };

    syncDialogOpenState(dialog, false);

    expect(dialog.close).not.toHaveBeenCalled();
  });
});

describe("handleDialogCancel", () => {
  it("does not prevent the default close when no confirmClose predicate is given", () => {
    const event = { preventDefault: vi.fn() };

    handleDialogCancel(event, undefined);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("does not prevent the default close when confirmClose returns false", () => {
    const event = { preventDefault: vi.fn() };

    handleDialogCancel(event, () => false);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("prevents the default close when confirmClose returns true", () => {
    const event = { preventDefault: vi.fn() };

    handleDialogCancel(event, () => true);

    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});

describe("handleCloseButtonClick", () => {
  it("calls onClose when no confirmClose predicate is given", () => {
    const onClose = vi.fn();

    handleCloseButtonClick(onClose, undefined);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when confirmClose returns false", () => {
    const onClose = vi.fn();

    handleCloseButtonClick(onClose, () => false);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose when confirmClose returns true", () => {
    const onClose = vi.fn();

    handleCloseButtonClick(onClose, () => true);

    expect(onClose).not.toHaveBeenCalled();
  });
});
