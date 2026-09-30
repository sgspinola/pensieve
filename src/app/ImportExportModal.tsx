"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Modal } from "./Modal";
import { FlashcardImportFlow } from "./FlashcardImportFlow";
import { ItemImportFlow } from "./ItemImportFlow";
import { SampleSnippet } from "./SampleSnippet";
import { CONTENT_KINDS, type ContentKind } from "./import-export-kinds";
import styles from "./ImportExportModal.module.css";

/**
 * Ticket 05 of batch-import-export-and-article-item-type: the account
 * menu's "Import / Export" entry opens this chooser rather than a dedicated
 * page. Flashcards (tickets 05/06) and Links/Tools/Articles (ticket 07) are
 * all wired up; wiki pages are never offered as a content type here.
 *
 * backlog/issues/01 collapsed the original type-then-action wizard (three
 * step screens behind Back buttons) into this single always-visible view:
 * the type picker, the Import column, and the Export column (a shared
 * `.ioRow` — a later design pass put them side by side to cut down the
 * modal's height) are all mounted from the first render and merely
 * `disabled` until `contentType` is chosen, instead of being conditionally
 * mounted per step. `contentType` is keyed onto the rendered import flow so
 * switching kinds mid-flow always remounts it at `idle` rather than reusing
 * stale parsed-file state under a new kind.
 *
 * The type picker itself is a single row of radio bullets rather than a
 * `<select>` (a later design pass): a native `<select>` reads as a dropdown
 * even before it's opened, whereas all four choices sitting in view side by
 * side is the point — there are only four, so there's no need to hide them
 * behind a click. `contentType` starts `null` with no radio checked, which
 * already doubles as the "nothing picked yet" state a `<select>`'s explicit
 * placeholder option used to represent.
 *
 * backlog/issues/02 added `activeSampleTab`, a second and deliberately
 * separate piece of state for the read-only sample browser below: it starts
 * on its own default and is never read from or written to `contentType` in
 * either direction, since browsing a sample format has nothing to do with
 * which kind you're about to import/export.
 */
const EXPORT_HREF: Record<ContentKind, string> = {
  flashcards: "/api/flashcards/export",
  link: "/api/items/export?kind=link",
  tool: "/api/items/export?kind=tool",
  article: "/api/items/export?kind=article",
};

export function ImportExportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [contentType, setContentType] = useState<ContentKind | null>(null);
  const [activeSampleTab, setActiveSampleTab] = useState<ContentKind>("flashcards");

  function handleClose() {
    setContentType(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} showCloseButton ariaLabelledBy="import-export-heading">
      <h2 id="import-export-heading" className={styles.heading}>
        Import / Export
      </h2>

      <span id="import-export-type-label" className={styles.fieldLabel}>
        Content type
      </span>
      <div className={styles.typeRow} role="radiogroup" aria-labelledby="import-export-type-label">
        {CONTENT_KINDS.map((type) => (
          <label key={type.value} className={styles.typeOption}>
            <input
              type="radio"
              name="import-export-type"
              value={type.value}
              checked={contentType === type.value}
              onChange={() => setContentType(type.value)}
            />
            {type.label}
          </label>
        ))}
      </div>

      <div className={styles.ioRow}>
        <div className={styles.ioColumn}>
          <h3 className={styles.sectionHeading}>Import</h3>
          {contentType === "flashcards" ? (
            <FlashcardImportFlow key="flashcards" enabled />
          ) : (
            <ItemImportFlow
              key={contentType ?? "__none__"}
              kind={contentType ?? "link"}
              enabled={contentType !== null}
            />
          )}
        </div>

        <div className={styles.ioColumn}>
          <h3 className={styles.sectionHeading}>Export</h3>
          <a
            className={styles.optionButton}
            aria-disabled={contentType === null}
            tabIndex={contentType === null ? -1 : undefined}
            href={EXPORT_HREF[contentType ?? "link"]}
            download
            onClick={(event) => {
              if (contentType === null) event.preventDefault();
            }}
          >
            <Download size={15} aria-hidden="true" />
            Export
          </a>
        </div>
      </div>

      <SampleSnippet open={open} activeTab={activeSampleTab} onTabChange={setActiveSampleTab} />
    </Modal>
  );
}
