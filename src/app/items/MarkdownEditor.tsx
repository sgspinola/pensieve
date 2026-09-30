"use client";

import { useId, useState } from "react";
import MDEditor, {
  bold,
  italic,
  link,
  quote,
  code,
  codeBlock,
  unorderedListCommand,
  orderedListCommand,
  checkedListCommand,
  table,
} from "@uiw/react-md-editor/nohighlight";
import MarkdownPreview from "@uiw/react-markdown-preview/nohighlight";
import { useColorMode } from "@/app/useColorMode";
import { MARKDOWN_REHYPE_PLUGINS } from "./markdown-plugins";
import "./markdown-theme.module.css";
import styles from "./MarkdownEditor.module.css";

// Approved toolbar set only (spec: no other library-default buttons left
// in). `extraCommands` is passed as `[]` below to drop the library's
// default fullscreen/live-preview icons, since this component drives
// write/preview itself via the tab toggle.
const TOOLBAR_COMMANDS = [
  bold,
  italic,
  link,
  unorderedListCommand,
  orderedListCommand,
  quote,
  code,
  codeBlock,
  table,
  checkedListCommand,
];

export function MarkdownEditor({
  id,
  value,
  onChange,
  required,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const panelId = useId();
  const colorMode = useColorMode();

  return (
    <div className={styles.editor} data-color-mode={colorMode}>
      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "write"}
          aria-controls={panelId}
          className={tab === "write" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => setTab("write")}
        >
          Write
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "preview"}
          aria-controls={panelId}
          className={tab === "preview" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => setTab("preview")}
        >
          Preview
        </button>
      </div>
      <div id={panelId} role="tabpanel">
        {tab === "write" ? (
          <MDEditor
            value={value}
            onChange={(next) => onChange(next ?? "")}
            preview="edit"
            visibleDragbar={false}
            defaultTabEnable
            commands={TOOLBAR_COMMANDS}
            extraCommands={[]}
            textareaProps={{ id, required }}
            data-color-mode={colorMode}
          />
        ) : (
          // Reuses the exact same read-only renderer as ItemRow's saved-item
          // view (same component, same plugin config, same explicit
          // `data-color-mode`), so the Preview tab shows exactly what will be
          // shown once saved, per spec.
          <div className={styles.previewPane}>
            <MarkdownPreview
              source={value}
              rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
              wrapperElement={{ "data-color-mode": colorMode }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
