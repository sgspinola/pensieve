"use client"; // Error boundaries must be Client Components

import buttonStyles from "@/app/form-controls.module.css";
import styles from "./error.module.css";

/**
 * Shared markup for this app's error.tsx boundaries (ticket 08: root and
 * /wiki). Each call site only supplies its own copy and picks its own outer
 * landmark element — kept out of here since the root boundary needs its own
 * `<main>` while the /wiki boundary already renders inside WikiLayout's.
 *
 * Deliberately generic: nothing from the thrown `error` is accepted or
 * rendered here, and nothing is sent anywhere — UI fallback only.
 */
export function ErrorFallback({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className={styles.panel} data-testid="error-fallback">
      <h2 className={styles.heading}>Something went wrong</h2>
      <p className={styles.message}>{message}</p>
      <button
        type="button"
        className={`${buttonStyles.button} ${styles.retry}`}
        onClick={() => retry()}
      >
        Try again
      </button>
    </div>
  );
}
