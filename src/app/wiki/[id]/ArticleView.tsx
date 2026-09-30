"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { readErrorMessage } from "@/lib/http-client";
import { DeleteArticleConfirm } from "@/app/items/DeleteArticleConfirm";
import { MarkdownBlock } from "@/app/items/MarkdownBlock";
import { MarkdownEditor } from "@/app/items/MarkdownEditor";
import { ParentArticleSelect } from "@/app/items/ParentArticleSelect";
import { TagsInput } from "@/app/items/TagsInput";
import fieldStyles from "@/app/items/form-field.module.css";
import "@/app/items/markdown-theme.module.css";
import styles from "./ArticleView.module.css";

export interface ArticleViewItem {
  id: string;
  title: string | null;
  content: string | null;
  notes: string | null;
  parentId: string | null;
  tags: string[];
}

export interface ArticleAncestor {
  id: string;
  title: string;
}

/**
 * `/wiki`'s content pane: a breadcrumb trail above the article, an
 * always-visible Edit affordance (open to any workspace member — ticket 02's
 * open-editing rule, unlike the unified item list's creator-or-admin gate),
 * and the same field set/behavior as `ItemRow.tsx`'s article edit path,
 * built from the same shared primitives (`MarkdownEditor`, `TagsInput`,
 * `ParentArticleSelect`) rather than reusing `ItemRow` itself.
 */
export function ArticleView({
  item,
  ancestors,
  tagSuggestions,
  canDelete,
  isAdmin,
  childCount,
}: {
  item: ArticleViewItem;
  ancestors: ArticleAncestor[];
  tagSuggestions: string[];
  canDelete: boolean;
  isAdmin: boolean;
  childCount: number;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(item.title ?? "");
  const [content, setContent] = useState(item.content ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [parentId, setParentId] = useState<string | null>(item.parentId ?? null);
  const [tags, setTags] = useState(item.tags);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ticket 09: mirrors ItemRow's confirm panel — `true` means the has-children
  // promote/cascade panel is showing (childCount is already known server-side
  // from the already-fetched tree, so there's no client fetch needed here).
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function startEditing() {
    setTitle(item.title ?? "");
    setContent(item.content ?? "");
    setNotes(item.notes ?? "");
    setParentId(item.parentId ?? null);
    setTags(item.tags);
    setError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setTitle(item.title ?? "");
    setContent(item.content ?? "");
    setNotes(item.notes ?? "");
    setParentId(item.parentId ?? null);
    setTags(item.tags);
    setError(null);
    setIsEditing(false);
  }

  async function handleSave() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, notes, tags, parentId }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      setIsEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes");
    } finally {
      setPending(false);
    }
  }

  async function deleteViaApi(cascade: boolean): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const url = cascade ? `/api/items/${item.id}?cascade=true` : `/api/items/${item.id}`;
      const response = await fetch(url, { method: "DELETE" });
      if (!response.ok && response.status !== 204) throw new Error(await readErrorMessage(response));
      // WikiLayout (the sidebar's tree + this content pane's parent) stays
      // mounted across `/wiki/*` navigations, so `push` alone swaps the
      // content pane back to the index but leaves the sidebar showing the
      // now-deleted article until the layout's server data is refetched —
      // `refresh()` after the navigation does that (same push-then-refresh
      // pairing AddItemForm's own default success path uses).
      router.push("/wiki");
      router.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete item");
      setPending(false);
      return false;
    }
  }

  function handleDelete() {
    if (childCount > 0) {
      setConfirmingDelete(true);
      return;
    }
    if (!window.confirm(`Delete "${item.title || "Untitled"}"?`)) return;
    void deleteViaApi(false);
  }

  return (
    <article>
      <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
        <ol className={styles.breadcrumbList}>
          {ancestors.map((ancestor) => (
            <li key={ancestor.id} className={styles.breadcrumbItem}>
              <Link href={`/wiki/${ancestor.id}`} className={styles.breadcrumbLink}>
                {ancestor.title || "Untitled"}
              </Link>
              <span className={styles.breadcrumbSeparator} aria-hidden="true">
                ›
              </span>
            </li>
          ))}
          <li className={styles.breadcrumbItem} aria-current="page">
            {item.title || "Untitled"}
          </li>
        </ol>
      </nav>

      <div className={styles.card}>
        {isEditing ? (
          <div className={styles.editForm}>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor={`article-${item.id}-title`}>
                Title
              </label>
              <input
                id={`article-${item.id}-title`}
                className={fieldStyles.field}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor={`article-${item.id}-content`}>
                Content (markdown)
              </label>
              <MarkdownEditor id={`article-${item.id}-content`} value={content} onChange={setContent} />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor={`article-${item.id}-parent`}>
                Parent page
              </label>
              <ParentArticleSelect
                id={`article-${item.id}-parent`}
                value={parentId}
                onChange={setParentId}
                excludeId={item.id}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor={`article-${item.id}-notes`}>
                Notes (markdown)
              </label>
              <MarkdownEditor id={`article-${item.id}-notes`} value={notes} onChange={setNotes} />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor={`article-${item.id}-tags`}>
                Tags
              </label>
              <TagsInput
                id={`article-${item.id}-tags`}
                tags={tags}
                onChange={setTags}
                suggestions={tagSuggestions}
              />
            </div>
            <div className={styles.actions}>
              <button className={styles.button} type="button" onClick={handleSave} disabled={pending}>
                Save
              </button>
              <button
                className={styles.buttonSecondary}
                type="button"
                onClick={cancelEditing}
                disabled={pending}
              >
                Cancel
              </button>
            </div>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className={styles.header}>
              <h1 className={styles.title}>{item.title || "Untitled"}</h1>
              <div className={styles.headerActions}>
                <button className={styles.editButton} type="button" onClick={startEditing}>
                  Edit
                </button>
                {canDelete && (
                  <button
                    className={styles.deleteButton}
                    type="button"
                    onClick={handleDelete}
                    disabled={pending}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
            {confirmingDelete && (
              <DeleteArticleConfirm
                childCount={childCount}
                isAdmin={isAdmin}
                pending={pending}
                onPromote={async () => {
                  if (!(await deleteViaApi(false))) return;
                }}
                onCascade={async () => {
                  if (!(await deleteViaApi(true))) return;
                }}
                onCancel={() => setConfirmingDelete(false)}
              />
            )}
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            {item.content ? (
              <MarkdownBlock source={item.content} isExpanded />
            ) : (
              <p className={styles.empty}>This page has no content yet.</p>
            )}
          </>
        )}
      </div>
    </article>
  );
}
