"use client"; // Error boundaries must be Client Components

import { ErrorFallback } from "@/app/ErrorFallback";

/**
 * `/wiki` segment boundary. Sits inside wiki/layout.tsx (WikiLayout), so a
 * crash in wiki/page.tsx or wiki/[id]/page.tsx replaces only the content
 * pane — the sidebar/article-tree shell stays mounted, which is the more
 * local boundary the root error.tsx (src/app/error.tsx) can't offer. No
 * outer landmark here: it renders inside WikiLayout's own `<main>`.
 */
export default function WikiErrorBoundary({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorFallback message="We hit a problem loading this article. Please try again." retry={retry} />
  );
}
