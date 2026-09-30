"use client";

import MarkdownPreview from "@uiw/react-markdown-preview/nohighlight";
import { useColorMode } from "@/app/useColorMode";
import { MARKDOWN_REHYPE_PLUGINS } from "./markdown-plugins";
import "./markdown-theme.module.css";
import styles from "./MarkdownBlock.module.css";

/**
 * Renders one block of markdown source (`content` or `notes`) read-only.
 * Extracted from `ItemRow.tsx` (ticket 06) so `ItemRow`'s compact-grid
 * truncate/fade treatment and `/wiki`'s always-expanded read view can share
 * exactly one rehype config, clamp/fade treatment, and `data-color-mode`
 * pinning without drifting apart from each other.
 *
 * `isExpanded` toggles the clamp/fade truncation — pass `true` for a
 * context (like `/wiki`'s article pane) that should never truncate.
 *
 * Explicitly `"use client"`: `@uiw/react-markdown-preview` uses client-only
 * hooks internally, and this component is now imported directly from a
 * Server Component (`/wiki/[id]/page.tsx`), not just from within an
 * already-client-boundary file like `ItemRow.tsx` — without its own
 * directive here, that direct import would render as a Server Component
 * and crash the first time a client hook runs inside it.
 */
export function MarkdownBlock({ source, isExpanded }: { source: string; isExpanded: boolean }) {
  const colorMode = useColorMode();
  return (
    <div className={isExpanded ? styles.markdownBody : `${styles.markdownBody} ${styles.clamp}`}>
      <MarkdownPreview
        source={source}
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
        wrapperElement={{ "data-color-mode": colorMode }}
      />
    </div>
  );
}
