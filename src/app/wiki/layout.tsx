import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/current-user";
import { listItems } from "@/services/items/items";
import { buildArticleTree } from "@/services/items/wiki";
import { listTags } from "@/services/tags/tags";
import { Header } from "@/app/Header";
import { Wordmark } from "@/app/Wordmark";
import shellStyles from "@/app/page-shell.module.css";
import { WikiShell } from "./WikiShell";

/**
 * The `/wiki` section's shared shell: persistent sidebar (the full,
 * alphabetized, always-expanded article tree) beside a content pane that
 * `/wiki/page.tsx` (empty/prompt state), `/wiki/[id]/page.tsx` (a single
 * article), or `WikiShell`'s own creation panel renders into as `children`.
 * Fetching the tree here rather than in each page is what makes navigating
 * between articles an in-place pane update — App Router keeps this layout
 * mounted across `<Link>` navigations within `/wiki/*`, only swapping
 * `children`, so the sidebar itself never unmounts/reloads.
 */
export default async function WikiLayout({ children }: { children: React.ReactNode }) {
  const user = await requireCurrentUser();

  const db = getDb();
  const rawArticles = await listItems(db, { kinds: ["page"] });
  // ArticleLike (buildArticleTree's constraint) requires `title: string`;
  // ItemWithCreator's `title` is `string | null` at the DB layer, same
  // null-to-"" normalization deleteArticleWithChildren already does before
  // calling buildArticleTree (see src/services/items/wiki.ts).
  const articles = rawArticles.map((article) => ({ ...article, title: article.title ?? "" }));
  const tree = buildArticleTree(articles);
  const tagSuggestions = await listTags(db);

  return (
    <main className={`${shellStyles.shell} ${shellStyles.wide}`}>
      <h1>
        <Wordmark />
      </h1>
      <Header user={user} />
      <WikiShell tree={tree} tagSuggestions={tagSuggestions}>
        {children}
      </WikiShell>
    </main>
  );
}
