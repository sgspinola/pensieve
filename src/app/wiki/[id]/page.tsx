import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/current-user";
import { getItem, listItems } from "@/services/items/items";
import { getAncestorChain } from "@/services/items/wiki";
import { getItemTagNames, listTags } from "@/services/tags/tags";
import { NotFoundError } from "@/services/errors";
import { ArticleView } from "./ArticleView";

/**
 * The selected article's pane: a breadcrumb trail (ticket 07, via
 * `getAncestorChain`) above the article, rendered by the client
 * `ArticleView` component which also owns the open-to-anyone inline edit
 * form (title/content/notes/tags/parent) built from the same field
 * primitives `ItemRow.tsx`'s article edit path uses.
 */
export default async function WikiArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireCurrentUser();

  let item;
  try {
    item = await getItem(getDb(), id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  // Someone navigated to a link/tool/article's id under /wiki/[id] — treat it
  // the same as not found rather than rendering a non-page as if it were one.
  if (item.kind !== "page") notFound();

  const db = getDb();
  const [tags, rawArticles, tagSuggestions] = await Promise.all([
    getItemTagNames(db, id),
    listItems(db, { kinds: ["page"] }),
    listTags(db),
  ]);
  // ArticleLike (getAncestorChain's constraint) requires `title: string`;
  // ItemWithCreator's `title` is `string | null` at the DB layer — same
  // null-to-"" normalization layout.tsx already does before buildArticleTree.
  const articles = rawArticles.map((article) => ({ ...article, title: article.title ?? "" }));
  const ancestorChain = getAncestorChain(articles, id);
  // Drop the article itself (the chain's last element) — ArticleView renders
  // its own current-page breadcrumb segment separately.
  const ancestors = ancestorChain.slice(0, -1).map((ancestor) => ({
    id: ancestor.id,
    title: ancestor.title,
  }));

  // Ticket 09: deletion is a narrower permission than editing (which is open
  // to everyone per ticket 07) — same creator-or-admin gate the unified item
  // list already uses. Child count comes from the already-fetched article
  // tree (`rawArticles`), so no extra client round trip is needed to decide
  // between the plain-confirm and promote/cascade delete UI.
  const canDelete = user.role === "admin" || user.id === item.createdBy;
  const isAdmin = user.role === "admin";
  const childCount = rawArticles.filter((article) => article.parentId === id).length;

  return (
    <ArticleView
      item={{
        id: item.id,
        title: item.title,
        content: item.content,
        notes: item.notes,
        parentId: item.parentId,
        tags,
      }}
      ancestors={ancestors}
      tagSuggestions={tagSuggestions}
      canDelete={canDelete}
      isAdmin={isAdmin}
      childCount={childCount}
    />
  );
}
