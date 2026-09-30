/**
 * Pure, DB-free helpers for assembling a flat list of wiki-style articles
 * (anything with an `id`, a `parentId`, and a `title`) into a tree, walking
 * a breadcrumb's ancestor chain, and detecting whether a proposed reparent
 * would introduce a cycle. This is the one new seam the wiki hierarchy
 * feature introduces, sitting beside items.ts the way tags.ts does — no
 * `db` parameter, no I/O. A later, DB-backed service (items.ts) composes
 * these with real queries.
 *
 * deleteArticleWithChildren (ticket 04) is the one exception: it's the
 * single DB-touching export in this file, deliberately kept here rather
 * than in items.ts because it's the one place that composes
 * buildArticleTree with a real delete. It imports canModifyItem from
 * items.ts, which already imports wouldCreateCycle FROM this file — a
 * circular import that's safe here because both sides only use the
 * imported binding inside function bodies, never at module-top-level.
 */

import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { itemTags, items } from "@/db/schema";
import { getLogger } from "@/lib/logging";
import type { SessionUser } from "@/services/auth/session";
import { NotFoundError, UnauthorizedError } from "@/services/errors";
import { canModifyItem } from "@/services/items/items";
import { logMutationSuccess } from "@/services/mutation-log";
import { pruneUnusedTags } from "@/services/tags/tags";

// Wiki pages are `kind: "page"` rows in the same `items` table items.ts
// mutates, so mutation logs from here share its logger category and
// entity rather than introducing a separate "wiki" one.
const logger = getLogger(["pensieve", "items"]);
const ENTITY = "items";

/** The minimal shape these functions need from an article-like row. */
export interface ArticleLike {
  id: string;
  parentId: string | null;
  title: string;
}

/** An article nested into a tree, with its ordered child subtrees attached. */
export type ArticleTreeNode<T extends ArticleLike> = T & { children: ArticleTreeNode<T>[] };

/**
 * Nests a flat article list into a tree (technically a forest: multiple
 * root nodes are returned when more than one article has `parentId ===
 * null`). Siblings — including the top-level roots — are ordered
 * alphabetically by title. Articles whose `parentId` doesn't match any
 * other id in the list are treated as roots too, so a dangling reference
 * can't silently drop a subtree.
 */
export function buildArticleTree<T extends ArticleLike>(articles: T[]): ArticleTreeNode<T>[] {
  const nodesById = new Map<string, ArticleTreeNode<T>>();
  for (const article of articles) {
    nodesById.set(article.id, { ...article, children: [] });
  }

  const roots: ArticleTreeNode<T>[] = [];
  for (const article of articles) {
    const node = nodesById.get(article.id)!;
    const parent = article.parentId !== null ? nodesById.get(article.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortByTitle = (a: ArticleTreeNode<T>, b: ArticleTreeNode<T>) => a.title.localeCompare(b.title);
  const sortRecursively = (nodes: ArticleTreeNode<T>[]) => {
    nodes.sort(sortByTitle);
    for (const node of nodes) sortRecursively(node.children);
  };
  sortRecursively(roots);

  return roots;
}

/**
 * Walks `articleId` up through `parentId` links to the root, then reverses
 * the result so it reads root-to-self (the order a breadcrumb trail wants).
 * The article itself is the last element of the returned list.
 *
 * Throws if `articleId` isn't found in `articles`. A malformed/missing
 * `parentId` reference simply ends the walk early rather than throwing,
 * since a dangling parent link shouldn't crash breadcrumb rendering.
 */
export function getAncestorChain<T extends ArticleLike>(articles: T[], articleId: string): T[] {
  const byId = new Map(articles.map((article) => [article.id, article]));

  const start = byId.get(articleId);
  if (!start) {
    throw new Error(`getAncestorChain: no article found with id "${articleId}"`);
  }

  const chain: T[] = [];
  let current: T | undefined = start;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    chain.push(current);
    seen.add(current.id);
    current = current.parentId !== null ? byId.get(current.parentId) : undefined;
  }

  return chain.reverse();
}

/**
 * Returns true when setting `candidateParentId` as `articleId`'s parent
 * would make `articleId` its own ancestor — either directly
 * (`candidateParentId === articleId`) or because `articleId` already
 * appears somewhere in `candidateParentId`'s ancestor chain. Reuses
 * getAncestorChain to walk from `candidateParentId` up to the root.
 */
export function wouldCreateCycle<T extends ArticleLike>(
  articles: T[],
  articleId: string,
  candidateParentId: string,
): boolean {
  if (candidateParentId === articleId) return true;

  const candidateExists = articles.some((article) => article.id === candidateParentId);
  if (!candidateExists) return false;

  const candidateAncestors = getAncestorChain(articles, candidateParentId);
  return candidateAncestors.some((article) => article.id === articleId);
}

/** Finds the subtree node matching `id` anywhere in a forest, or undefined. */
function findTreeNode<T extends ArticleLike>(
  nodes: ArticleTreeNode<T>[],
  id: string,
): ArticleTreeNode<T> | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findTreeNode(node.children, id);
    if (found) return found;
  }
  return undefined;
}

/** Flattens a subtree node plus every nested descendant into a flat id list. */
function flattenSubtreeIds<T extends ArticleLike>(node: ArticleTreeNode<T>): string[] {
  return [node.id, ...node.children.flatMap((child) => flattenSubtreeIds(child))];
}

export interface DeleteArticleOptions {
  // Default (falsy): promote the article's direct children up a level
  // (creator-or-admin). Opt-in true: delete the article and every
  // descendant in one shot (admin-only).
  cascade?: boolean;
}

/**
 * Deletes a wiki article. Two mutually exclusive behaviors, chosen by
 * `options.cascade`:
 *
 * - Promote (default, `cascade` falsy): requires creator-or-admin
 *   (canModifyItem). The article's direct children are re-parented to
 *   *its* parent (so a nested delete doesn't dump children to top-level),
 *   then the article itself is deleted — both in one transaction.
 * - Cascade (`cascade: true`): admin-only. The article and every
 *   descendant, at any depth, are deleted together in one transaction.
 *
 * Throws NotFoundError if the article doesn't exist (matching getItem's
 * convention), UnauthorizedError if the actor lacks permission for the
 * requested mode. Either mode also prunes any tag left with no items
 * referencing it once the deleted article(s)' own tags are gone (see
 * pruneUnusedTags) — `item_tags` rows cascade away with the item, but the
 * `tags` row itself wouldn't otherwise.
 *
 * Every row this function actually writes gets its own mutation-log line
 * (ticket 25) — a cascade can silently remove an entire subtree, and a
 * promote silently reparents every direct child, so `deleteItem`'s single
 * generic "Item deleted" for the root id isn't enough of an audit trail on
 * its own. Failures are deliberately not caught/logged here: they bubble up
 * to `deleteItem`'s own try/catch, which already logs exactly one
 * "Item deletion failed" line for either mode.
 */
export async function deleteArticleWithChildren(
  db: Database,
  actor: SessionUser,
  id: string,
  options: DeleteArticleOptions = {},
): Promise<void> {
  const [article] = await db.select().from(items).where(eq(items.id, id));
  if (!article) {
    throw new NotFoundError("Item not found");
  }

  if (options.cascade) {
    if (actor.role !== "admin") {
      throw new UnauthorizedError("Only an admin can delete an article and its descendants");
    }

    const allArticleRows = await db
      .select({ id: items.id, parentId: items.parentId, title: items.title })
      .from(items)
      .where(eq(items.kind, "page"));
    const allArticles = allArticleRows.map((row) => ({ ...row, title: row.title ?? "" }));

    const forest = buildArticleTree(allArticles);
    const subtreeRoot = findTreeNode(forest, id);
    const idsToDelete = subtreeRoot ? flattenSubtreeIds(subtreeRoot) : [id];

    const deletedTagRows = await db.transaction(async (tx) => {
      const rows = await tx
        .select({ tagId: itemTags.tagId })
        .from(itemTags)
        .where(inArray(itemTags.itemId, idsToDelete));
      await tx.delete(items).where(inArray(items.id, idsToDelete));
      return rows;
    });
    for (const deletedId of idsToDelete) {
      logMutationSuccess(logger, "Item deleted", { entity: ENTITY, kind: "page", entityId: deletedId });
    }
    await pruneUnusedTags(
      db,
      deletedTagRows.map((row) => row.tagId),
    );
    return;
  }

  if (!canModifyItem(actor, article)) {
    throw new UnauthorizedError("You do not have permission to modify this item");
  }

  const { deletedTagRows, reparentedIds } = await db.transaction(async (tx) => {
    const rows = await tx.select({ tagId: itemTags.tagId }).from(itemTags).where(eq(itemTags.itemId, id));
    const children = await tx.select({ id: items.id }).from(items).where(eq(items.parentId, id));
    await tx.update(items).set({ parentId: article.parentId }).where(eq(items.parentId, id));
    await tx.delete(items).where(eq(items.id, id));
    return { deletedTagRows: rows, reparentedIds: children.map((child) => child.id) };
  });
  for (const childId of reparentedIds) {
    logMutationSuccess(logger, "Item updated", {
      entity: ENTITY,
      kind: "page",
      entityId: childId,
      changedFields: ["parentId"],
    });
  }
  logMutationSuccess(logger, "Item deleted", { entity: ENTITY, kind: "page", entityId: id });
  await pruneUnusedTags(
    db,
    deletedTagRows.map((row) => row.tagId),
  );
}
