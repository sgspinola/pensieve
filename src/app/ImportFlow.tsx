"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { readErrorMessage } from "@/lib/http-client";
import styles from "./ImportExportModal.module.css";

type Stage =
  | { status: "idle" }
  | { status: "parsing" }
  | { status: "ready"; file: string; count: number }
  | { status: "importing"; file: string }
  | { status: "done"; summary: string }
  | { status: "error"; message: string };

/**
 * Generic pick-a-file -> parse -> show-a-count -> confirm -> commit flow
 * (ticket 06's Flashcards Import, generalized in ticket 07 for Links/
 * Tools/Articles rather than forking a near-identical copy per content
 * type). `extraBody` is merged into both the preview and commit request
 * bodies — e.g. `{ kind: "link" }` for an item import, omitted entirely
 * for flashcards (which has no per-request kind). `describeResult` turns
 * the commit response into the one-line summary shown when done, since
 * flashcards ("Created N, updated M") and items ("Created N") report
 * different shapes.
 *
 * The `sampleHref` prop/link this used to render (`backlog/issues/02`) was
 * removed in favor of `SampleSnippet`'s copyable in-modal preview.
 */
export function ImportFlow({
  previewUrl,
  commitUrl,
  extraBody,
  describeResult,
  enabled,
}: {
  previewUrl: string;
  commitUrl: string;
  extraBody?: Record<string, unknown>;
  describeResult: (result: Record<string, number>) => string;
  /** Gates the file input and confirm button until a content kind is picked (backlog/issues/01). */
  enabled: boolean;
}) {
  const [stage, setStage] = useState<Stage>({ status: "idle" });

  async function postJson(url: string, file: string) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...extraBody, file }),
    });
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setStage({ status: "parsing" });
    const text = await file.text();

    try {
      const response = await postJson(previewUrl, text);
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const { count } = await response.json();
      setStage({ status: "ready", file: text, count });
    } catch (err) {
      setStage({ status: "error", message: err instanceof Error ? err.message : "Could not parse the file" });
    }
  }

  async function handleConfirm() {
    if (stage.status !== "ready") return;
    setStage({ status: "importing", file: stage.file });

    try {
      const response = await postJson(commitUrl, stage.file);
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const result = await response.json();
      setStage({ status: "done", summary: describeResult(result) });
    } catch (err) {
      setStage({ status: "error", message: err instanceof Error ? err.message : "Could not import the file" });
    }
  }

  return (
    <div className={styles.chooser}>
      {(stage.status === "idle" || stage.status === "error") && (
        <>
          <label className={styles.fieldLabel} htmlFor="import-file">
            Choose a file to import
          </label>
          <input
            id="import-file"
            type="file"
            accept=".md,text/markdown"
            disabled={!enabled}
            onChange={handleFileChange}
          />
        </>
      )}

      {stage.status === "parsing" && <p>Parsing…</p>}

      {stage.status === "error" && (
        <p role="alert" className={styles.error}>
          {stage.message}
        </p>
      )}

      {stage.status === "ready" && (
        <>
          <p>
            Parsed {stage.count} {stage.count === 1 ? "entry" : "entries"}.
          </p>
          <button type="button" className={styles.optionButton} disabled={!enabled} onClick={handleConfirm}>
            <Upload size={15} aria-hidden="true" />
            Confirm import
          </button>
        </>
      )}

      {stage.status === "importing" && <p>Importing…</p>}

      {stage.status === "done" && <p>{stage.summary}</p>}
    </div>
  );
}
