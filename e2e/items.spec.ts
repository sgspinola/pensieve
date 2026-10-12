import fs from "node:fs";
import "dotenv/config";
import { test, expect } from "@playwright/test";
import { getDb } from "../src/db/client";
import { createItem } from "../src/services/items/items";
import { SEEDED_USER_FILE } from "./global-setup";
import { trackPageErrors, addLinkWithTag } from "./helpers";

test("authenticated user sees the workspace shell and nav tabs", async ({ page }) => {
  const errors = trackPageErrors(page);

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "PENSIEVE" })).toBeVisible();
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("link", { name: "Library" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Wiki" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Flashcards" })).toBeVisible();
  // Ticket 03: [ADD ITEM] moved out of the persistent nav into the library
  // page's own Search header.
  await expect(nav.getByRole("link", { name: "Add item" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add item" })).toBeVisible();

  errors.assertNone();
});

test("can add a link from the Add Item form and see it in the library", async ({ page }) => {
  const errors = trackPageErrors(page);
  const url = `https://example.com/playwright-smoke-${Date.now()}`;

  await page.goto("/items/new");
  await page.getByLabel("URL").fill(url);
  // Title is required as of ticket 03 — filled explicitly (rather than
  // relying on the real metadata fetch this fake URL wouldn't satisfy) with
  // the url itself so the "link text equals url" assertion below still
  // holds via ItemRow's `item.title || item.url` fallback.
  await page.getByLabel("Title", { exact: true }).fill(url);
  await page.getByRole("button", { name: "Add item" }).click();

  await page.waitForURL("/");
  await expect(page.getByRole("link", { name: url })).toBeVisible();

  errors.assertNone();
});

test("main page's tag cloud and kind chip row filter items without crashing", async ({ page }) => {
  const errors = trackPageErrors(page);
  const tag = `playwright-cloud-${Date.now()}`;
  const url = `https://example.com/playwright-cloud-${Date.now()}`;

  // Explicitly a Link (the form defaults to Tool): the kind-chip step below
  // relies on deselecting "Link" hiding this item.
  await page.goto("/items/new");
  await page.getByRole("radio", { name: "Link" }).click();
  await page.getByLabel("URL").fill(url);
  await page.getByLabel("Title", { exact: true }).fill(url);
  await page.getByLabel("Tags").fill(tag);
  await page.getByLabel("Tags").press("Enter");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.waitForURL("/");
  await expect(page.getByRole("link", { name: url })).toBeVisible();

  // Tag cloud (the restyled TagCloud component): selecting the tag chip
  // filters the list down to matching items.
  await page.getByRole("button", { name: tag }).click();
  await page.waitForURL(/tags=/);
  await expect(page.getByRole("link", { name: url })).toBeVisible();

  // Kind chip row: deselecting Link excludes the item even though its tag
  // still matches, proving the two rows now filter independently.
  await page.getByRole("button", { name: "Link" }).click();
  await expect(page.getByRole("link", { name: url })).toHaveCount(0);

  errors.assertNone();
});

test("items list: deleting the last item with a filtered tag self-heals the filter and the URL", async ({ page }) => {
  const errors = trackPageErrors(page);
  const tag = `playwright-stale-tag-item-${Date.now()}`;
  const url = `https://example.com/playwright-stale-tag-item-${Date.now()}`;

  await page.goto("/items/new");
  await page.getByLabel("URL").fill(url);
  await page.getByLabel("Title", { exact: true }).fill(url);
  await page.getByLabel("Tags").fill(tag);
  await page.getByLabel("Tags").press("Enter");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.waitForURL("/");

  await page.goto(`/?tags=${encodeURIComponent(tag)}`);
  await expect(page.getByRole("link", { name: url })).toBeVisible();
  const chip = page.getByRole("button", { name: tag });
  await expect(chip).toHaveAttribute("aria-pressed", "true");

  // Deleting the only item carrying this tag prunes the tag row entirely —
  // same self-healing behavior as the flashcards list (they share the same
  // pruneUnusedTags-driven staleness and the same fix).
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete item" }).click();

  await page.waitForURL((currentUrl) => !currentUrl.search.includes(tag));
  await expect(page.getByRole("button", { name: tag })).toHaveCount(0);
  await expect(page.getByRole("link", { name: url })).toHaveCount(0);

  errors.assertNone();
});

test("Add Item form's Cancel button returns to the library without submitting", async ({ page }) => {
  const errors = trackPageErrors(page);

  await page.goto("/items/new");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.waitForURL("/");
  await expect(page.getByRole("heading", { name: "PENSIEVE" })).toBeVisible();

  errors.assertNone();
});

test("library page: tag search box narrows the tag cloud independently of the item search box", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  const tagAlpha = `playwright-lib-filter-alpha-${Date.now()}`;
  const tagBeta = `playwright-lib-filter-beta-${Date.now()}`;
  const urlAlpha = `https://example.com/playwright-lib-alpha-${Date.now()}`;
  const urlBeta = `https://example.com/playwright-lib-beta-${Date.now()}`;

  await addLinkWithTag(page, urlAlpha, tagAlpha);
  await addLinkWithTag(page, urlBeta, tagBeta);

  await page.goto("/");
  await expect(page.getByRole("button", { name: tagAlpha })).toBeVisible();
  await expect(page.getByRole("button", { name: tagBeta })).toBeVisible();

  // Ticket 03: a dedicated "Filter tags" box (the same shared TagFilterInput
  // the study page uses) narrows the tag cloud live — separate from the item
  // search box below. Substring/case-insensitive matching itself is already
  // covered by TagFilterInput.test.ts and the study page's own Playwright
  // spec above; this spec's job is just proving the Library-page-specific
  // wiring (independence from the item search box) actually hydrates.
  const tagFilterInput = page.getByLabel("Filter tags");
  await tagFilterInput.fill("alpha");
  await expect(page.getByRole("button", { name: tagAlpha })).toBeVisible();
  await expect(page.getByRole("button", { name: tagBeta })).toHaveCount(0);

  // Typing in the tag search box must not touch the item list: both items
  // (whose kinds/tags/query the item search box hasn't filtered) stay visible.
  await expect(page.getByRole("link", { name: urlAlpha })).toBeVisible();
  await expect(page.getByRole("link", { name: urlBeta })).toBeVisible();

  await tagFilterInput.fill("");
  await expect(page.getByRole("button", { name: tagBeta })).toBeVisible();

  // The item search box independently filters the item list server-side —
  // unaffected by, and not affecting, the tag search box or tag cloud above.
  const itemSearchInput = page.getByLabel("Search titles, descriptions, notes, and tags");
  await itemSearchInput.fill(tagAlpha);
  await page.waitForURL(/query=/);
  await expect(page.getByRole("link", { name: urlAlpha })).toBeVisible();
  await expect(page.getByRole("link", { name: urlBeta })).toHaveCount(0);
  await expect(tagFilterInput).toHaveValue("");
  await expect(page.getByRole("button", { name: tagAlpha })).toBeVisible();
  await expect(page.getByRole("button", { name: tagBeta })).toBeVisible();

  errors.assertNone();
});

test("items library: server-renders exactly the first page, and scrolling loads the rest, without changing the true count (ticket 02)", async ({
  page,
}) => {
  const errors = trackPageErrors(page);

  // Seeded directly via the service layer (same DB this run's Playwright
  // config points at) rather than 35 slow UI submissions — mirrors the
  // flashcards pagination spec above. `description: null` (rather than
  // omitted) skips createItem's metadata-fetch prefill entirely, same as
  // the existing item-edit spec below.
  const { userId } = JSON.parse(fs.readFileSync(SEEDED_USER_FILE, "utf-8")) as { userId: string };
  const db = getDb();
  const seedTitle = `Playwright pagination seed ${Date.now()}`;
  for (let i = 0; i < 35; i++) {
    await createItem(db, {
      creatorId: userId,
      kind: "link",
      url: `https://example.com/playwright-pagination-${Date.now()}-${i}`,
      title: `${seedTitle} ${i}`,
      description: null,
    });
  }

  await page.goto("/");

  // Exactly one page's worth of rows server-rendered up front, no matter
  // how many items now exist in total (proves the "(30)" default limit, not
  // just "some items showed up") — matched by the "Added by <name>" meta
  // line every ItemRow renders.
  const rows = page.locator("li", { hasText: "Added by" });
  await expect(rows).toHaveCount(30);

  // The heading's true count reflects every matching item, not just the
  // loaded page — it must already be >= 35 (this seed alone), well past the
  // 30 rows actually rendered above.
  const heading = page.getByRole("heading", { name: /^Items \(\d+\)$/ });
  const headingTextBeforeScroll = (await heading.textContent()) ?? "";
  const countBeforeScroll = Number(headingTextBeforeScroll.match(/\((\d+)\)/)?.[1]);
  expect(countBeforeScroll).toBeGreaterThanOrEqual(35);

  // Scroll the sentinel near the bottom of the list into view — the real
  // trigger for the IntersectionObserver-driven fetch, not a "Load more"
  // button click, so this proves the actual scroll-triggered client fetch
  // path hydrates and runs in a real browser.
  await page.mouse.wheel(0, 20000);

  // At least one more batch loaded: this only ever grows past 30 via a
  // successful client-side fetch appending to the list.
  await expect(rows).not.toHaveCount(30);

  // Scrolling to load more pages must not change the displayed count.
  await expect(heading).toHaveText(headingTextBeforeScroll);

  errors.assertNone();
});

test("editing an item opens the modal pre-filled, saving updates the Library list, and canceling a dirty edit discards it (ticket 07)", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  // A tag unique to this run, same isolation convention as ticket 06's
  // flashcard-editing spec above: filtering straight to it via `?tags=`
  // guarantees this is the only card in view, regardless of what else the
  // shared workspace-wide Library list holds or what other specs seed in
  // parallel.
  const tag = `playwright-item-edit-${Date.now()}`;
  const url = `https://example.com/playwright-item-edit-${Date.now()}`;
  const title = `Playwright Item Edit Original ${Date.now()}`;
  const description = "Original description.";
  const updatedTitle = `${title} — edited`;

  const { userId } = JSON.parse(fs.readFileSync(SEEDED_USER_FILE, "utf-8")) as { userId: string };
  const db = getDb();
  await createItem(db, { creatorId: userId, kind: "link", url, title, description, tags: [tag] });

  await page.goto(`/?tags=${encodeURIComponent(tag)}`);
  await expect(page.getByText(title, { exact: false })).toBeVisible();

  // Opens ticket 02's Modal (a real <dialog> via showModal()) rendering the
  // shared ItemForm in edit mode, pre-filled from this item's current
  // values — none of this (native dialog, real form pre-fill) is
  // reproducible under this repo's jsdom-less Vitest, hence Playwright.
  await page.getByRole("button", { name: "Edit item" }).click();
  // Scope every field lookup to the dialog itself: the Library's own item
  // search box (label "Search titles, descriptions, notes, and tags") would
  // otherwise ambiguously match a substring `getByLabel("Title")` lookup
  // against the whole page.
  const modal = page.getByRole("dialog");
  const heading = modal.getByRole("heading", { name: "Edit item" });
  await expect(heading).toBeVisible();
  await expect(modal.getByLabel("URL")).toHaveValue(url);
  await expect(modal.getByLabel("Title", { exact: false })).toHaveValue(title);
  await expect(modal.getByLabel("Description")).toHaveValue(description);
  await expect(modal.getByRole("button", { name: `Remove tag ${tag}` })).toBeVisible();
  // Ticket 03: showCloseButton is opt-in and only the flashcard edit dialog
  // passes it — the item-edit dialog must show no × control.
  await expect(modal.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);

  await modal.getByLabel("Title", { exact: false }).fill(updatedTitle);
  await modal.getByRole("button", { name: "Save" }).click();

  // Saving PATCHes, closes the modal, and refreshes the list (no in-place
  // client-side patching of the row) rather than patching it in place.
  await expect(heading).toHaveCount(0);
  await expect(page.getByText(updatedTitle, { exact: false })).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);

  // Reopening and making an unsaved edit, then Cancel: the form is now
  // dirty, so a native confirm() gates the discard (Modal's confirmClose
  // contract, exercised here via the form's own Cancel button rather than
  // Esc) — accepting it closes without saving.
  await page.getByRole("button", { name: "Edit item" }).click();
  await expect(heading).toBeVisible();
  await modal.getByLabel("Title", { exact: false }).fill("This edit should be discarded");
  page.once("dialog", (dialog) => dialog.accept());
  await modal.getByRole("button", { name: "Cancel" }).click();

  await expect(heading).toHaveCount(0);
  await expect(page.getByText(updatedTitle, { exact: false })).toBeVisible();
  await expect(page.getByText("This edit should be discarded")).toHaveCount(0);

  errors.assertNone();
});
