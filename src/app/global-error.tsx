"use client"; // Error boundaries must be Client Components

import styles from "./global-error.module.css";

/**
 * Top-level fallback for crashes in the root layout itself (fonts, the
 * `cookies()` theme read, etc.) — the one place src/app/error.tsx can't
 * reach, since an error.tsx never wraps the layout.tsx in its own segment.
 * Must define its own <html>/<body>: it replaces the root layout when
 * active, so app globals (including the [data-theme] cookie attribute)
 * aren't available — see global-error.module.css.
 *
 * Generic message only; nothing from `error` is rendered, and nothing is
 * sent anywhere — UI fallback only, no crash reporting.
 */
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className={styles.body}>
        <div className={styles.panel}>
          <h2>Something went wrong</h2>
          <p className={styles.message}>The app hit a problem loading. Please try again.</p>
          <button type="button" className={styles.retry} onClick={() => retry()}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
