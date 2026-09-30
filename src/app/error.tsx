"use client"; // Error boundaries must be Client Components

import shellStyles from "@/app/page-shell.module.css";
import { ErrorFallback } from "./ErrorFallback";

/**
 * Root-level render-crash boundary. Wraps every route nested under `/`
 * (everything except the root layout itself — see global-error.tsx for
 * that) that doesn't have a more local error.tsx of its own (ticket 08:
 * "most local boundary possible" — `/wiki` gets its own, below, so a
 * crash there keeps the sidebar shell mounted).
 */
export default function ErrorBoundary({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className={shellStyles.shell}>
      <ErrorFallback message="We hit a problem loading this page. Please try again." retry={retry} />
    </main>
  );
}
