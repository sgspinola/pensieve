import { Link } from "lucide-react";
import styles from "./SourceCitation.module.css";

/**
 * Renders a flashcard's `source` (ticket 04's free-form citation text) as a
 * clickable link when it looks like an http(s) URL — the common case, since
 * most sources are cheat-sheet/benchmark URLs — and as plain text otherwise,
 * since `source` isn't restricted to a bare URL.
 *
 * The value (link or plain text) ellipsizes on one line rather than wrapping
 * — long cheat-sheet/benchmark URLs would otherwise stretch the card taller.
 * "Source:" itself never truncates, only the value next to it.
 */
export function SourceCitation({
  source,
  className,
  iconClassName,
}: {
  source: string;
  className?: string;
  /** Styles the leading icon; omit to render the label with no icon (e.g. the study-session flip card). */
  iconClassName?: string;
}) {
  const isUrl = /^https?:\/\//i.test(source);

  return (
    <p className={className}>
      <span className={styles.row}>
        {iconClassName && <Link size={12} className={iconClassName} aria-hidden="true" />}
        <span className={styles.label}>Source:</span>
        <span className={styles.value} title={source}>
          {isUrl ? (
            <a href={source} target="_blank" rel="noreferrer">
              {source}
            </a>
          ) : (
            source
          )}
        </span>
      </span>
    </p>
  );
}
