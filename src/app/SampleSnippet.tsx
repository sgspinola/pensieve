"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { CONTENT_KINDS, type ContentKind } from "./import-export-kinds";
import styles from "./SampleSnippet.module.css";

export type SampleKind = ContentKind;

const SAMPLE_HREF: Record<SampleKind, string> = {
  flashcards: "/api/flashcards/import/sample",
  link: "/api/items/import/sample?kind=link",
  tool: "/api/items/import/sample?kind=tool",
  article: "/api/items/import/sample?kind=article",
};

/** Derived from `CONTENT_KINDS` (rather than its own copy) so a kind can't be added/renamed in one place and missed in the other. */
const SAMPLE_TABS = CONTENT_KINDS.map((kind) => ({ ...kind, href: SAMPLE_HREF[kind.value] }));

const TABPANEL_ID = "sample-snippet-panel";

/**
 * backlog/issues/02: a read-only reference panel that replaces the old
 * per-kind "Download sample file" link, which required a full file
 * round-trip just to see the expected import format. Deliberately has its
 * own `activeTab` state, owned by the caller (`ImportExportModal`) but
 * never synced with the main content-type select in either direction —
 * browsing samples is unrelated to what you're about to import/export.
 *
 * `open` only gates *when* the four samples are first fetched, not whether
 * this component is mounted: `ImportExportModal` (and this) stay mounted in
 * the DOM at all times (a native `<dialog>`'s visibility, not its React
 * mounted-ness, is what `open` toggles — see `Modal.tsx`), and that modal
 * itself is rendered unconditionally by the account menu on every
 * authenticated page. Without this guard, every page load would fire four
 * authenticated sample fetches whether or not Import/Export is ever opened.
 * A ref (not state) tracks "have we fetched yet" so reopening the modal
 * doesn't refetch samples already in hand.
 */
export function SampleSnippet({
  open,
  activeTab,
  onTabChange,
}: {
  open: boolean;
  activeTab: SampleKind;
  onTabChange: (tab: SampleKind) => void;
}) {
  const [samples, setSamples] = useState<Partial<Record<SampleKind, string>>>({});
  const [copiedTab, setCopiedTab] = useState<SampleKind | null>(null);
  const copied = copiedTab === activeTab;
  const hasFetchedRef = useRef(false);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    let cancelled = false;
    for (const tab of SAMPLE_TABS) {
      fetch(tab.href)
        .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
        .then((text) => {
          if (!cancelled) setSamples((prev) => ({ ...prev, [tab.value]: text }));
        })
        .catch(() => {
          if (!cancelled) setSamples((prev) => ({ ...prev, [tab.value]: "Could not load this sample." }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleCopy() {
    const text = samples[activeTab];
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const tab = activeTab;
      setCopiedTab(tab);
      // Clear any still-pending reset from an earlier click on this same tab
      // so a rapid re-copy doesn't have that earlier timeout clear the
      // "Copied" label out from under the new click before its own 1500ms
      // are up.
      if (copyResetTimeoutRef.current !== null) clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = setTimeout(() => {
        setCopiedTab((current) => (current === tab ? null : current));
        copyResetTimeoutRef.current = null;
      }, 1500);
    } catch {
      // Clipboard access can be denied by the browser/OS; the affordance
      // simply doesn't confirm rather than crashing the modal.
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.tabStrip} role="tablist" aria-label="Sample content">
        {SAMPLE_TABS.map((tab) => (
          <button
            key={tab.value}
            id={`sample-tab-${tab.value}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.value}
            aria-controls={TABPANEL_ID}
            className={activeTab === tab.value ? styles.tabActive : styles.tab}
            onClick={() => onTabChange(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        className={styles.snippetWrap}
        role="tabpanel"
        id={TABPANEL_ID}
        aria-labelledby={`sample-tab-${activeTab}`}
      >
        <button type="button" className={styles.copyButton} onClick={handleCopy}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
        <pre className={styles.pre}>
          <code>{samples[activeTab] ?? "Loading…"}</code>
        </pre>
      </div>
    </div>
  );
}
