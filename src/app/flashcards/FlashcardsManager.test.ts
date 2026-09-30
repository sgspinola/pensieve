import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// `FlashcardsManager` uses `useRouter` (from `next/navigation`) for its
// post-mutation `router.refresh()` call. That hook reads from a Next.js
// app-router context provider that doesn't exist under plain
// `react-dom/server` rendering, so — same reasoning as `Modal.test.ts`/
// `ItemsLibrary.test.ts`'s use of `renderToStaticMarkup` for a hooks-using,
// non-DOM-testable component — the module is mocked with a no-op
// stand-in. Effects (the `IntersectionObserver` infinite-scroll wiring)
// never run under SSR anyway, so this only covers the static wiring —
// whether the infinite-scroll sentinel renders exactly when there's a next
// page to fetch — not interactive scroll behavior (covered by Playwright
// per ticket 04). `flashcards` is left empty in every case so no
// `FlashcardRow` (which pulls in the markdown editor/preview) ever renders.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/flashcards",
}));

const { FlashcardsManager, buildLoadMoreQuery, buildTagFilterUrl, buildTagsUrl } = await import("./FlashcardsManager");

function baseProps() {
  return {
    flashcards: [],
    nextCursor: null as string | null,
    currentUser: { id: "user-1", displayName: "Ada", role: "member" as const },
    tagSuggestions: [],
    tagsFilter: [] as string[],
    hasStaleTags: false,
    total: 0,
  };
}

// Ticket 05: pure URL/query-string builders behind the tag filter's
// navigation and paginated-fetch behavior, exported for direct unit testing
// the same way route.ts pulls out parseLimitParam — no DOM/fetch/router
// needed to verify these. `buildTagFilterUrl`'s output is what actually
// resets the list to page 1 under a new filter: navigating to a URL with
// different search params makes `/flashcards/page.tsx` (a dynamic,
// searchParams-reading Server Component) re-render with a fresh
// `key={randomUUID()}`, which fully remounts `FlashcardsManager` — the same
// discard-and-reseed-from-props mechanism ticket 04 already relies on for
// the post-mutation refresh, verified there via Playwright. That live
// remount-on-navigation isn't independently re-verified at the unit level
// here (it requires a real browser/router, not just DOM), so the new
// Playwright spec below covers it end-to-end.
describe("buildTagFilterUrl", () => {
  it("adds the clicked tag as a `tags` param when none are selected yet", () => {
    expect(buildTagFilterUrl("/flashcards", [], "ai")).toBe("/flashcards?tags=ai");
  });

  it("appends to already-selected tags, preserving OR-selection order", () => {
    expect(buildTagFilterUrl("/flashcards", ["ai"], "ml")).toBe("/flashcards?tags=ai&tags=ml");
  });

  it("removes a tag that's already selected (toggle off)", () => {
    expect(buildTagFilterUrl("/flashcards", ["ai", "ml"], "ai")).toBe("/flashcards?tags=ml");
  });

  it("returns the bare pathname (no `?`) once the last tag is cleared", () => {
    expect(buildTagFilterUrl("/flashcards", ["ai"], "ai")).toBe("/flashcards");
  });
});

// The stale-tag self-correction effect (see the class doc comment) resolves
// to this: given the already-corrected tagsFilter it received as a prop,
// what URL should the address bar be replaced with. Covers the building
// block directly; the effect wiring itself (when it fires, that it doesn't
// loop) isn't independently unit-testable here since effects never run
// under `renderToStaticMarkup` — see e2e/smoke.spec.ts's "flashcards list:
// deleting the last card with a filtered tag..." spec for the live path.
describe("buildTagsUrl", () => {
  it("returns the bare pathname when the corrected selection is empty", () => {
    expect(buildTagsUrl("/flashcards", [])).toBe("/flashcards");
  });

  it("serializes the given tags as repeated `tags` params", () => {
    expect(buildTagsUrl("/flashcards", ["ai", "ml"])).toBe("/flashcards?tags=ai&tags=ml");
  });
});

describe("buildLoadMoreQuery", () => {
  it("carries only the cursor and default limit with no active tag filter", () => {
    expect(buildLoadMoreQuery("some-cursor", [])).toBe("limit=30&cursor=some-cursor");
  });

  it("appends the active tag filter as repeated `tags` params, so infinite scroll pages through the filtered set", () => {
    expect(buildLoadMoreQuery("some-cursor", ["ai", "ml"])).toBe(
      "limit=30&cursor=some-cursor&tags=ai&tags=ml",
    );
  });
});

describe("FlashcardsManager infinite-scroll wiring", () => {
  // Four `aria-hidden="true"` nodes already render unconditionally regardless
  // of the sentinel: the tag-filter box's own `.cursorCue` (ticket 05), the
  // "Add flashcard" and "Study" action links' icons, and the empty-state
  // Layers icon (baseProps() renders zero flashcards) — so these now count
  // occurrences (4 = baseline, 5 = baseline + sentinel `<li>`) rather than
  // asserting the attribute's bare presence/absence.
  function countAriaHiddenTrue(html: string): number {
    return html.split('aria-hidden="true"').length - 1;
  }

  it("renders no sentinel when the server-rendered first page says there's nothing more to load", () => {
    const html = renderToStaticMarkup(createElement(FlashcardsManager, baseProps()));

    expect(countAriaHiddenTrue(html)).toBe(4);
  });

  it("renders a sentinel element when a nextCursor is given, ready for the IntersectionObserver to watch", () => {
    const html = renderToStaticMarkup(
      createElement(FlashcardsManager, { ...baseProps(), nextCursor: "some-opaque-cursor" }),
    );

    expect(countAriaHiddenTrue(html)).toBe(5);
  });

  it("renders the server-provided true total in the heading, not the loaded flashcards count (ticket 01)", () => {
    const html = renderToStaticMarkup(
      createElement(FlashcardsManager, {
        ...baseProps(),
        total: 1,
        flashcards: [
          {
            id: "card-1",
            front: "Q",
            back: "A",
            frontHash: "hash-1",
            source: "https://example.com",
            createdBy: "user-1",
            createdByName: "Ada",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            tags: [],
          },
        ],
      }),
    );

    expect(html).toContain("Flashcards (1)");
  });

  it("renders `total`, not `flashcards.length`, when they diverge (ticket 01: a page loaded so far is not the true total)", () => {
    const html = renderToStaticMarkup(
      createElement(FlashcardsManager, {
        ...baseProps(),
        total: 42,
        flashcards: [
          {
            id: "card-1",
            front: "Q",
            back: "A",
            frontHash: "hash-1",
            source: "https://example.com",
            createdBy: "user-1",
            createdByName: "Ada",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            tags: [],
          },
        ],
      }),
    );

    expect(html).toContain("Flashcards (42)");
    expect(html).not.toContain("Flashcards (1)");
  });
});

describe("FlashcardsManager tag filter wiring (ticket 05)", () => {
  it("renders a tag-filter input and tag cloud wired from tagSuggestions", () => {
    const html = renderToStaticMarkup(
      createElement(FlashcardsManager, { ...baseProps(), tagSuggestions: ["alpha", "beta"] }),
    );

    expect(html).toContain('id="flashcards-tag-filter"');
    expect(html).toContain("Filter tags");
    expect(html).toContain(">alpha<");
    expect(html).toContain(">beta<");
  });

  it("reflects tagsFilter selection on the tag chips", () => {
    const html = renderToStaticMarkup(
      createElement(FlashcardsManager, {
        ...baseProps(),
        tagSuggestions: ["alpha", "beta"],
        tagsFilter: ["beta"],
      }),
    );

    expect(html).toMatch(/beta<\/button>/);
    expect(html).toContain('aria-pressed="true"');
  });

  it("shows a filtered-empty-state message distinct from the unfiltered empty state", () => {
    const filteredHtml = renderToStaticMarkup(
      createElement(FlashcardsManager, { ...baseProps(), tagsFilter: ["ai"] }),
    );
    const unfilteredHtml = renderToStaticMarkup(createElement(FlashcardsManager, baseProps()));

    expect(filteredHtml).toContain("No flashcards match the selected tags.");
    expect(unfilteredHtml).toContain("No flashcards yet.");
  });
});
