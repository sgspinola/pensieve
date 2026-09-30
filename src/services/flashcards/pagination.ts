/**
 * Flashcards list page size (ticket 04): the size of `/flashcards`'s
 * SSR-rendered first page and of every infinite-scroll batch after it. In
 * its own module, not `flashcards.ts`, so `FlashcardsManager` (a "use
 * client" component) can import just this constant without pulling in
 * `flashcards.ts`'s Node-only `@/db/client`/drizzle imports into the client
 * bundle — a plain number has no business needing a Postgres driver import
 * (code-review-mattpocock, Standards axis).
 */
export const FLASHCARDS_PAGE_SIZE = 30;
