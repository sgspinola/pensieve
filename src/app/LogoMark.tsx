/**
 * The Pensieve mark: a basin catching three drawn-up memories, redrawn in
 * the same stroke language as the app's Lucide icon set (round caps/joins,
 * currentColor) rather than the old pixel-block glyph. Used everywhere the
 * mark appears (icon.svg, Wordmark) — icon.svg is a separate static file
 * (favicons can't inherit currentColor) kept in sync with this shape by hand.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8.5 20h7l3.5-7h-14z" />
      <ellipse cx="12" cy="13" rx="7.5" ry="1.6" />
      <path d="M7.2 9.2c.5-1 1.6-1 2.1 0" />
      <path d="M10.9 6.2c.5-1 1.6-1 2.1 0" />
      <path d="M14.7 9.2c.5-1 1.6-1 2.1 0" />
    </svg>
  );
}
