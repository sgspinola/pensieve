"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import fieldStyles from "@/app/items/form-field.module.css";
import type { ArticleLike, ArticleTreeNode } from "@/services/items/wiki";
import { filterArticleTree } from "./wiki-search";
import styles from "./WikiSidebar.module.css";

// The sidebar only ever needs id/parentId/title off each node — ArticleLike
// (buildArticleTree's own constraint, `title: string`) is a narrower,
// simpler prop type than threading the full ItemWithCreator shape through.
// `content` is added on top purely so wiki-search can read it here — the
// runtime objects layout.tsx passes already have it (it spreads a full
// ItemWithCreator row), this is a TS-level widening only, not a data-flow
// change.
type WikiArticle = ArticleLike & { content: string | null };

/**
 * Recursively renders one level of the article tree (and, via itself,
 * every level below it) as a nested `<ul>`. No collapse/expand state
 * anywhere — every node always shows all of its children, per the ticket.
 * `pathname` is threaded down (rather than each node calling `usePathname`
 * itself) purely to avoid a redundant hook call per node.
 */
function ArticleTreeList({
  nodes,
  pathname,
  onAddChild,
}: {
  nodes: ArticleTreeNode<WikiArticle>[];
  pathname: string;
  onAddChild: (parentId: string) => void;
}) {
  if (nodes.length === 0) return null;

  return (
    <ul className={styles.tree}>
      {nodes.map((node) => {
        const href = `/wiki/${node.id}`;
        const title = node.title || "Untitled";
        return (
          <li key={node.id}>
            <div className={styles.nodeRow}>
              <Link
                href={href}
                className={pathname === href ? `${styles.nodeLink} ${styles.nodeLinkActive}` : styles.nodeLink}
              >
                {title}
              </Link>
              <button
                type="button"
                className={styles.addChildButton}
                onClick={() => onAddChild(node.id)}
                aria-label={`Add child page under ${title}`}
                title="Add child page"
              >
                +
              </button>
            </div>
            <ArticleTreeList nodes={node.children} pathname={pathname} onAddChild={onAddChild} />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The `/wiki` section's persistent sidebar: the full article tree (see
 * `ArticleTreeList` above) plus the two creation entry points. Both "New
 * article" and each node's "Add child page" just report the intent upward
 * (`onNewArticle`/`onAddChild`) — `WikiShell` (the sidebar's parent) owns
 * the actual creation panel and renders it into the content pane instead of
 * this narrow column, so a full-width form doesn't have to squeeze sideways.
 */
export function WikiSidebar({
  tree,
  onNewArticle,
  onAddChild,
}: {
  tree: ArticleTreeNode<WikiArticle>[];
  onNewArticle: () => void;
  onAddChild: (parentId: string) => void;
}) {
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState("");
  const isSearching = searchQuery.trim().length > 0;

  // When searching, flatten to just the matching articles (title or
  // content — see wiki-search.ts for why this differs from the main
  // workspace page's search) and strip their children so ArticleTreeList
  // renders them as a flat result list instead of recursing into
  // non-matching descendants. Otherwise render the full tree unchanged.
  const displayNodes: ArticleTreeNode<WikiArticle>[] = isSearching
    ? filterArticleTree(tree, searchQuery).map((node) => ({ ...node, children: [] }))
    : tree;

  return (
    <nav className={styles.sidebar} aria-label="Wiki pages">
      <button type="button" className={styles.newArticleButton} onClick={onNewArticle}>
        + New page
      </button>
      {tree.length > 0 && (
        <div className={styles.searchField}>
          <label className={styles.searchLabel} htmlFor="wiki-search">
            Search pages by title or content
          </label>
          <input
            id="wiki-search"
            type="search"
            className={fieldStyles.field}
            placeholder="Search pages…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
      )}
      {tree.length === 0 ? (
        <p className={styles.empty}>No pages yet.</p>
      ) : displayNodes.length === 0 ? (
        <p className={styles.empty}>No pages match your search.</p>
      ) : (
        <ArticleTreeList nodes={displayNodes} pathname={pathname} onAddChild={onAddChild} />
      )}
    </nav>
  );
}
