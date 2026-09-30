import { Trash2 } from "lucide-react";
import styles from "./DeleteArticleConfirm.module.css";

/**
 * Ticket 09: the has-children delete confirmation, shared by `ItemRow.tsx`
 * and `/wiki`'s `ArticleView.tsx`. Replaces the plain `window.confirm()` path
 * (which stays untouched for every childless/non-article delete) when an
 * article being deleted has children — surfacing ticket 04's already-built
 * promote/cascade server behavior. Presentational only: each call site keeps
 * its own fetch/pending/error state, since `ItemRow` and `ArticleView`
 * already have slightly different surrounding markup for that.
 */
export function DeleteArticleConfirm({
  childCount,
  isAdmin,
  onPromote,
  onCascade,
  onCancel,
  pending,
}: {
  childCount: number;
  isAdmin: boolean;
  onPromote: () => void;
  onCascade: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const childLabel = childCount === 1 ? "1 child page" : `${childCount} child pages`;

  return (
    <div className={styles.panel} role="alertdialog" aria-label="Confirm delete">
      <p className={styles.copy}>
        This page has {childLabel}. Deleting it will move them up a level.
        {!isAdmin && (
          <>
            {" "}
            <span className={styles.hint}>Ask an admin if you&rsquo;d like to delete the children too.</span>
          </>
        )}
      </p>
      <div className={styles.actions}>
        <button
          className={styles.button}
          type="button"
          onClick={onPromote}
          disabled={pending}
        >
          Delete page
        </button>
        {isAdmin && (
          <button
            className={styles.buttonDanger}
            type="button"
            onClick={onCascade}
            disabled={pending}
          >
            <Trash2 size={15} aria-hidden="true" />
            Delete branch
          </button>
        )}
        <button
          className={styles.buttonSecondary}
          type="button"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
