/**
 * Pure, client-side search filter for the `/wiki` sidebar. Deliberately a
 * separate, narrower rule from the main workspace page's search
 * (`itemMatchesSearchTerm` in `src/services/items/items.ts`, driving
 * `listItems`'s `query` option): that one matches title/description/notes/
 * tag names but never touches the `content` column at all. This one matches
 * title and content only — nothing else — and has no notion of tag chips.
 * `/wiki`'s data is already article-only, so there's no kind filter either.
 *
 * No I/O, no React — kept separate from WikiSidebar.tsx the same way
 * chip-filters.ts is kept separate from ItemsLibrary.tsx, so it's
 * independently unit-testable (see wiki-search.test.ts).
 */

import type { ArticleLike, ArticleTreeNode } from "@/services/items/wiki";

/** The minimal shape wiki-search needs from an article-like row. */
export interface SearchableArticle extends ArticleLike {
  content: string | null;
}

/**
 * True when `query` (trimmed, case-insensitive) is found in `article.title`
 * or `article.content`. An empty/whitespace-only query matches everything,
 * so callers can use this unconditionally without a separate "no query"
 * branch.
 */
export function articleMatchesSearch(
  article: Pick<SearchableArticle, "title" | "content">,
  query: string,
): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return (
    article.title.toLowerCase().includes(trimmed) ||
    (article.content ?? "").toLowerCase().includes(trimmed)
  );
}

/**
 * Walks the full article forest and returns a flat, depth-first-ordered
 * list of just the nodes matching `query` (title or content) — tree
 * structure (parent/child relationships) is deliberately discarded, not
 * preserved via ancestor pruning. "Find a specific article... without
 * scrolling the tree" reads most directly as "give me a flat list of
 * matches"; keeping a matched leaf's unrelated ancestors around to
 * contextualize it would work against that goal, not for it.
 *
 * An empty/whitespace-only query returns every node in the forest,
 * flattened, since articleMatchesSearch matches everything in that case.
 */
export function filterArticleTree<T extends SearchableArticle>(
  nodes: ArticleTreeNode<T>[],
  query: string,
): ArticleTreeNode<T>[] {
  const results: ArticleTreeNode<T>[] = [];

  function walk(list: ArticleTreeNode<T>[]) {
    for (const node of list) {
      if (articleMatchesSearch(node, query)) {
        results.push(node);
      }
      walk(node.children);
    }
  }

  walk(nodes);
  return results;
}
