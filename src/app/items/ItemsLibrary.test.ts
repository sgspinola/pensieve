import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// `ItemsLibrary` uses `useRouter`/`usePathname` (from `next/navigation`) to
// drive URL-based navigation on search/filter changes. Those hooks read from
// a Next.js app-router context provider that doesn't exist under plain
// `react-dom/server` rendering, so — same reasoning as `Modal.test.ts`'s use
// of `renderToStaticMarkup` for a hooks-using, non-DOM-testable component —
// the module is mocked with no-op stand-ins. Effects (the debounced
// `router.replace` navigation) never run under SSR anyway, so this only
// covers the static wiring: which inputs render and how they're wired to
// props, not interactive behavior (covered by Playwright, per this ticket).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/",
}));

const { ItemsLibrary, buildLoadMoreQuery } = await import("./ItemsLibrary");

function baseProps() {
  return {
    items: [],
    nextCursor: null as string | null,
    totalCount: 0,
    currentUser: { id: "user-1", displayName: "Ada", role: "member" as const },
    tagSuggestions: ["alpha", "beta", "gamma"],
    searchQuery: "",
    kindFilter: [],
    hasExplicitKindFilter: false,
    tagsFilter: [],
    hasStaleTags: false,
  };
}

describe("ItemsLibrary tag search wiring", () => {
  it("renders a tag-filter input independent from the item search box", () => {
    const html = renderToStaticMarkup(createElement(ItemsLibrary, baseProps()));

    // The pre-existing item search box, unaffected by this ticket.
    expect(html).toContain('id="items-search"');
    // The new tag-filter box this ticket adds, from the shared `TagFilterInput`.
    expect(html).toContain('id="library-tag-filter"');
    expect(html).toContain("Filter tags");
  });

  it("wires the tag-filter box's tag list from tagSuggestions, rendering every tag as a chip when the filter is empty", () => {
    const html = renderToStaticMarkup(createElement(ItemsLibrary, baseProps()));

    for (const tag of ["alpha", "beta", "gamma"]) {
      expect(html).toContain(`>${tag}<`);
    }
  });

  it("reflects tagsFilter selection on the tag chips regardless of the (empty) tag-filter query", () => {
    const html = renderToStaticMarkup(
      createElement(ItemsLibrary, { ...baseProps(), tagsFilter: ["beta"] }),
    );

    expect(html).toContain('aria-pressed="true"');
  });

  it("keeps the item search box's value tied to searchQuery, independent of the tag-filter box", () => {
    const html = renderToStaticMarkup(
      createElement(ItemsLibrary, { ...baseProps(), searchQuery: "widget" }),
    );

    expect(html).toMatch(/id="items-search"[^>]*value="widget"/);
    // The tag-filter box starts empty regardless of the item search query.
    expect(html).toMatch(/id="library-tag-filter"[^>]*value=""/);
  });
});

describe("ItemsLibrary kind chip row", () => {
  it("renders a chip for every non-wiki kind, but never one for the wiki page kind", () => {
    const html = renderToStaticMarkup(createElement(ItemsLibrary, baseProps()));

    expect(html).toContain("Link");
    expect(html).toContain("Tool");
    expect(html).toContain("Article");
    // Wiki pages are excluded from the library entirely — no chip offers a
    // way to bring them into this view.
    expect(html).not.toContain("Wiki");
  });
});

// Ticket 02: the heading must reflect the true COUNT(*)-backed total
// (`totalCount`), not the length of whatever page happens to be loaded —
// the two are deliberately different props so a test can prove the heading
// doesn't accidentally fall back to `items.length`.
describe("ItemsLibrary true count heading (ticket 02)", () => {
  it("renders totalCount in the heading, independent of how many items are actually loaded", () => {
    const html = renderToStaticMarkup(
      createElement(ItemsLibrary, { ...baseProps(), items: [], totalCount: 42 }),
    );

    expect(html).toContain("Items (42)");
  });
});

// Ticket 02: pure query-string builder behind infinite scroll's paginated
// fetch, exported for direct unit testing the same way route.ts pulls out
// parseLimitParam — mirrors FlashcardsManager.tsx's buildLoadMoreQuery.
describe("buildLoadMoreQuery", () => {
  it("carries only the cursor and default limit with no active filters", () => {
    expect(buildLoadMoreQuery("some-cursor", "", [], [])).toBe("limit=30&cursor=some-cursor");
  });

  it("appends the active search query", () => {
    expect(buildLoadMoreQuery("some-cursor", "widget", [], [])).toBe(
      "limit=30&cursor=some-cursor&query=widget",
    );
  });

  it("appends the active kind filter as repeated `kind` params", () => {
    expect(buildLoadMoreQuery("some-cursor", "", ["link", "tool"], [])).toBe(
      "limit=30&cursor=some-cursor&kind=link&kind=tool",
    );
  });

  it("appends the active tag filter as repeated `tags` params", () => {
    expect(buildLoadMoreQuery("some-cursor", "", [], ["ai", "ml"])).toBe(
      "limit=30&cursor=some-cursor&tags=ai&tags=ml",
    );
  });
});

describe("ItemsLibrary infinite-scroll wiring (ticket 02)", () => {
  // Four `aria-hidden="true"` nodes already render unconditionally regardless
  // of the sentinel with an empty `items` list: the item search box's
  // `.cursorCue`, the tag-filter box's own (from the shared
  // `TagFilterInput`), the "Add item" link's Plus icon, and the empty-state
  // Inbox icon (baseProps() renders zero items) — so these count occurrences
  // (baseline 4, +1 once the sentinel `<li>` renders) rather than asserting
  // bare presence/absence. Mirrors FlashcardsManager.test.ts's identical
  // technique.
  function countAriaHiddenTrue(html: string): number {
    return html.split('aria-hidden="true"').length - 1;
  }

  it("renders no sentinel when the server-rendered first page says there's nothing more to load", () => {
    const html = renderToStaticMarkup(createElement(ItemsLibrary, baseProps()));

    expect(countAriaHiddenTrue(html)).toBe(4);
  });

  it("renders a sentinel element when a nextCursor is given, ready for the IntersectionObserver to watch", () => {
    const html = renderToStaticMarkup(
      createElement(ItemsLibrary, { ...baseProps(), nextCursor: "some-opaque-cursor" }),
    );

    expect(countAriaHiddenTrue(html)).toBe(5);
  });
});
