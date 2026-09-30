/**
 * Items library page size (ticket 02): the size of `/`'s SSR-rendered first
 * page and of every infinite-scroll batch after it. In its own module, not
 * `items.ts`, so `ItemsLibrary` (a "use client" component) can import just
 * this constant without pulling in `items.ts`'s Node-only `@/db/client`/
 * drizzle imports into the client bundle — a plain number has no business
 * needing a Postgres driver import. Mirrors
 * `src/services/flashcards/pagination.ts`.
 */
export const ITEMS_PAGE_SIZE = 30;
