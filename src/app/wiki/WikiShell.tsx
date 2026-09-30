"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ItemForm } from "@/app/items/ItemForm";
import type { ArticleLike, ArticleTreeNode } from "@/services/items/wiki";
import { WikiSidebar } from "./WikiSidebar";
import styles from "./layout.module.css";
import creationStyles from "./WikiShell.module.css";

type WikiArticle = ArticleLike & { content: string | null };

/**
 * Owns the "New page"/"Add child page" creation flow that used to live
 * entirely inside `WikiSidebar`, squeezed into its 260px column. `WikiShell`
 * lifts that state up a level so the same `ItemForm` instead replaces
 * `children` in the content pane — full main-pane width, matching every
 * other `/wiki` content view — while the sidebar keeps only the buttons
 * that trigger it. `undefined` means the panel is closed, `null` means open
 * with no parent preselected ("New page"), and a string means open with
 * that node preselected as parent ("Add child page").
 */
export function WikiShell({
  tree,
  tagSuggestions,
  children,
}: {
  tree: ArticleTreeNode<WikiArticle>[];
  tagSuggestions: string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [creatingUnderParentId, setCreatingUnderParentId] = useState<string | null | undefined>(undefined);
  const isCreating = creatingUnderParentId !== undefined;

  function handleCreated(item: { id: string }, { stayOnPage }: { stayOnPage: boolean }) {
    if (stayOnPage) {
      // "Add & add another" — ItemForm already cleared its own fields;
      // just refresh so the newly created article shows up in the sidebar
      // tree, without navigating away from this still-open creation panel.
      router.refresh();
      return;
    }
    // router.refresh() re-fetches layout.tsx's server-rendered tree so the
    // just-created article actually appears in the sidebar afterward.
    router.push(`/wiki/${item.id}`);
    router.refresh();
    setCreatingUnderParentId(undefined);
  }

  return (
    <div className={styles.layout}>
      <WikiSidebar
        tree={tree}
        onNewArticle={() => setCreatingUnderParentId(null)}
        onAddChild={(parentId) => setCreatingUnderParentId(parentId)}
      />
      <div className={styles.content}>
        {isCreating ? (
          <div className={creationStyles.panel}>
            <h2 className={creationStyles.heading}>
              {creatingUnderParentId === null ? "New page" : "Add child page"}
            </h2>
            <ItemForm
              mode={{ kind: "create" }}
              tagSuggestions={tagSuggestions}
              defaultKind="page"
              lockKind
              defaultParentId={creatingUnderParentId}
              onSuccess={handleCreated}
              onCancel={() => setCreatingUnderParentId(undefined)}
            />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
