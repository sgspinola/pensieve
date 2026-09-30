import styles from "./page.module.css";

/**
 * The `/wiki` index route: no article selected yet. `layout.tsx` already
 * renders the sidebar and page shell, so this is just the content pane's
 * empty/prompt state.
 */
export default function WikiIndexPage() {
  return <p className={styles.empty}>Select a page from the sidebar, or create a new one.</p>;
}
