"use client";

import { useEffect, useState } from "react";
import fieldStyles from "./form-field.module.css";

type ArticleOption = { id: string; title: string };

/**
 * A `<select>` of existing wiki pages, for choosing a parent in the
 * hierarchy. Self-contained: fetches its own page list (same-origin
 * `GET /api/items?kind=page`, cookies flow automatically exactly like
 * `ItemForm.tsx`'s `handleUrlBlur`) rather than requiring every call site
 * to thread a pre-fetched list through as a prop — this keeps it trivially
 * droppable into any form (ticket 06's future `/wiki` flows included)
 * without touching `ItemsLibrary.tsx`/`app/page.tsx`'s prop chains.
 *
 * `refreshKey` is an escape hatch for callers that keep this component
 * mounted across multiple creations instead of remounting it — e.g.
 * `ItemForm`'s create-mode "Add & add another" path clears its own fields
 * in place, so without this the dropdown would never pick up an article
 * just created in the same session. Passing a value that changes after
 * each creation (any value works, only its identity is checked) re-runs
 * the fetch.
 */
export function ParentArticleSelect({
  id,
  value,
  onChange,
  excludeId,
  refreshKey,
}: {
  id: string;
  value: string | null;
  onChange: (value: string | null) => void;
  excludeId?: string;
  refreshKey?: number;
}) {
  const [articles, setArticles] = useState<ArticleOption[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadArticles() {
      try {
        const response = await fetch("/api/items?kind=page");
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        const items = Array.isArray(data.items) ? data.items : [];
        setArticles(
          items.map((item: { id: string; title: string | null }) => ({
            id: item.id,
            title: item.title || "Untitled",
          })),
        );
      } catch {
        // Leave the dropdown at its empty/previous state on network failure;
        // the form remains usable without a parent selection.
      }
    }

    loadArticles();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const options = articles
    .filter((article) => article.id !== excludeId)
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <select
      id={id}
      className={fieldStyles.field}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">— No parent (top-level) —</option>
      {options.map((article) => (
        <option key={article.id} value={article.id}>
          {article.title}
        </option>
      ))}
    </select>
  );
}
