import fs from "node:fs";
import "dotenv/config";
import { test, expect } from "@playwright/test";
import { getDb } from "../src/db/client";
import { createFlashcard } from "../src/services/flashcards/flashcards";
import { SEEDED_USER_FILE } from "./global-setup";
import { trackPageErrors } from "./helpers";

test("can create a flashcard from the management page and see its markdown rendered", async ({ page }) => {
  const errors = trackPageErrors(page);
  const front = `Playwright Flashcard Front ${Date.now()}`;

  await page.goto("/flashcards/new");
  await page.locator("#flashcard-front").fill(`${front} — **bold front**`);
  await page.locator("#flashcard-back").fill("Plain back text.");
  await page.locator("#flashcard-source").fill("https://example.com");
  // At least one tag is required by the form; pre-existing coverage gap
  // (this test predates that validation) unrelated to any of this batch's
  // tickets, fixed in passing while splitting smoke.spec.ts.
  await page.getByLabel("Tags").fill(`playwright-fc-create-${Date.now()}`);
  await page.getByLabel("Tags").press("Enter");
  await page.getByRole("button", { name: "Add flashcard" }).click();

  await page.waitForURL(/\/flashcards$/);
  await expect(page.getByText(front, { exact: false })).toBeVisible();
  // Rendered markdown, not the raw "**bold front**" source — same
  // MarkdownBlock-hydration proof the wiki page test above makes.
  await expect(page.getByText("bold front", { exact: false })).toBeVisible();

  errors.assertNone();
});

test("flashcards list: server-renders exactly the first page, and scrolling loads the rest (ticket 04)", async ({
  page,
}) => {
  const errors = trackPageErrors(page);

  // Seeded directly via the service layer (same DB this run's Playwright
  // config points at — see global-setup.ts's identical approach) rather
  // than 35 slow UI submissions: /flashcards lists every flashcard in the
  // workspace (not scoped to one user), so this only needs the total count
  // to exceed one page — which flashcard rows end up on which page isn't
  // otherwise asserted, since other specs in this suite create their own
  // flashcards too and run in parallel.
  const { userId } = JSON.parse(fs.readFileSync(SEEDED_USER_FILE, "utf-8")) as { userId: string };
  const db = getDb();
  for (let i = 0; i < 35; i++) {
    await createFlashcard(db, {
      creatorId: userId,
      front: `Pagination seed ${i}`,
      back: "Back",
      source: "https://example.com",
      tags: ["pagination-seed"],
    });
  }

  await page.goto("/flashcards");

  // Exactly one page's worth of rows server-rendered up front, no matter
  // how many flashcards now exist in total (proves the "(30)" default
  // limit, not just "some flashcards showed up") — matched by the "Added
  // by <name>" meta line every FlashcardRow renders, which the
  // infinite-scroll sentinel element (also an <li>, no such text) is
  // excluded by.
  const rows = page.locator("li", { hasText: "Added by" });
  await expect(rows).toHaveCount(30);

  // Scroll the sentinel near the bottom of the list into view — the real
  // trigger for the IntersectionObserver-driven fetch, not a "Load more"
  // button click, so this proves the actual scroll-triggered client fetch
  // path hydrates and runs in a real browser.
  await page.mouse.wheel(0, 20000);

  // At least one more batch loaded: this only ever grows past 30 via a
  // successful client-side fetch appending to the list.
  await expect(rows).not.toHaveCount(30);

  errors.assertNone();
});

test("flashcards list: selecting a tag narrows the list and updates the URL, clearing restores it (ticket 05)", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  const tagAlpha = `playwright-fc-alpha-${Date.now()}`;
  const tagBeta = `playwright-fc-beta-${Date.now()}`;
  const frontAlpha = `Playwright FC Alpha ${Date.now()}`;
  const frontBeta = `Playwright FC Beta ${Date.now()}`;

  // Seeded directly via the service layer (fast, same DB this run's
  // Playwright config points at — see the pagination spec above) with two
  // distinct single-tag cards, rather than the slower create-flashcard UI
  // flow: this spec's job is proving the tag-cloud click -> URL -> filtered
  // list wiring hydrates, not exercising the create form again.
  const { userId } = JSON.parse(fs.readFileSync(SEEDED_USER_FILE, "utf-8")) as { userId: string };
  const db = getDb();
  await createFlashcard(db, { creatorId: userId, front: frontAlpha, back: "Back", source: "https://example.com", tags: [tagAlpha] });
  await createFlashcard(db, { creatorId: userId, front: frontBeta, back: "Back", source: "https://example.com", tags: [tagBeta] });

  // Navigate straight to a `?tags=` URL selecting *both* tags at once
  // (OR semantics), rather than starting from the bare unfiltered
  // `/flashcards` list: /flashcards lists every flashcard in the shared
  // workspace, capped at one page of 30, and other specs in this suite seed
  // dozens of their own flashcards in parallel — asserting on the
  // unfiltered page's content here would be flaky depending on scheduling.
  // Filtering down to these two tags up front keeps this spec's result set
  // to exactly these two cards regardless of what else exists, while still
  // proving the filtered view is bookmarkable and that the SSR first page
  // already reflects the URL's filter with no unfiltered flash.
  const bothTagsParams = new URLSearchParams();
  bothTagsParams.append("tags", tagAlpha);
  bothTagsParams.append("tags", tagBeta);
  await page.goto(`/flashcards?${bothTagsParams.toString()}`);
  await expect(page.getByRole("button", { name: tagAlpha })).toBeVisible();
  await expect(page.getByRole("button", { name: tagBeta })).toBeVisible();
  await expect(page.getByText(frontAlpha)).toBeVisible();
  await expect(page.getByText(frontBeta)).toBeVisible();

  // Deselecting one tag (still OR-selected via the other) narrows the list
  // down to only the remaining tag's cards and updates the URL to match.
  await page.getByRole("button", { name: tagBeta }).click();
  await page.waitForURL((url) => url.searchParams.getAll("tags").length === 1);
  await expect(page.getByText(frontAlpha)).toBeVisible();
  await expect(page.getByText(frontBeta)).toHaveCount(0);

  // Clearing the last selected tag drops `?tags=` from the URL entirely,
  // returning to the full unfiltered list.
  await page.getByRole("button", { name: tagAlpha }).click();
  await page.waitForURL((url) => !url.search.includes("tags="));

  errors.assertNone();
});

test("flashcards list: the server-rendered first page already reflects a `?tags=` URL, and infinite scroll keeps paging through the filtered set (ticket 05)", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  const tag = `playwright-fc-scroll-filter-${Date.now()}`;

  // 35 cards sharing one tag unique to this run — enough to exceed one page
  // (30) of the *filtered* result set specifically, so growth past 30 can
  // only come from the filtered `GET /api/flashcards?tags=...&cursor=...`
  // path, not the unfiltered one.
  // Only 31 (the minimum that exceeds one page of 30), not the 35 the
  // ticket-04 pagination spec above uses for its own (unfiltered) list:
  // each card inserted here also lands in the shared workspace-wide
  // unfiltered `/flashcards` list other specs assert against directly (e.g.
  // "can create a flashcard...", the study-session spec), so keeping this
  // spec's own footprint to the minimum needed reduces (without touching
  // those specs' own logic) the odds of a page-1-cutoff race against them
  // when everything runs in parallel — the multi-page-under-a-tag-filter
  // correctness itself (skipping untagged cards, no skips/dupes across
  // pages) is covered independently, and without any such race, by
  // `flashcards.test.ts`'s "keeps paging through only the tag-filtered set"
  // test against a real (isolated, per-test) database.
  const { userId } = JSON.parse(fs.readFileSync(SEEDED_USER_FILE, "utf-8")) as { userId: string };
  const db = getDb();
  for (let i = 0; i < 31; i++) {
    await createFlashcard(db, { creatorId: userId, front: `Filtered scroll seed ${i}`, back: "Back", source: "https://example.com", tags: [tag] });
  }

  // Navigating straight to a `?tags=` URL (rather than clicking the chip)
  // proves the filtered view is bookmarkable and that the SSR first page
  // itself is already narrowed — no unfiltered flash before a client-side
  // filter kicks in.
  await page.goto(`/flashcards?tags=${encodeURIComponent(tag)}`);

  const rows = page.locator("li", { hasText: "Added by" });
  await expect(rows).toHaveCount(30);

  await page.mouse.wheel(0, 20000);

  await expect(rows).not.toHaveCount(30);

  errors.assertNone();
});

test("flashcards list: deleting the last card with a filtered tag self-heals the filter and the URL", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  const tag = `playwright-stale-tag-fc-${Date.now()}`;
  const front = `Stale Tag Flashcard ${Date.now()}`;

  const { userId } = JSON.parse(fs.readFileSync(SEEDED_USER_FILE, "utf-8")) as { userId: string };
  const db = getDb();
  await createFlashcard(db, { creatorId: userId, front, back: "A", source: "https://example.com", tags: [tag] });

  await page.goto(`/flashcards?tags=${encodeURIComponent(tag)}`);
  await expect(page.getByText(front, { exact: false })).toBeVisible();
  const chip = page.getByRole("button", { name: tag });
  await expect(chip).toHaveAttribute("aria-pressed", "true");

  // Deleting the only card carrying this tag prunes the tag row entirely
  // (its last reference is gone) — the chip should vanish (not just show
  // inactive), the card should disappear, and the URL should drop the now-
  // meaningless `?tags=` param instead of silently keeping the filter
  // applied with nothing left to show it's active.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete flashcard" }).click();

  await page.waitForURL((url) => !url.search.includes(tag));
  await expect(page.getByRole("button", { name: tag })).toHaveCount(0);
  await expect(page.getByText(front, { exact: false })).toHaveCount(0);

  errors.assertNone();
});

test("editing a flashcard opens the modal pre-filled, saving updates the list, and canceling a dirty edit discards it (ticket 06)", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  // A tag unique to this run, same reasoning as the tag-filtering specs
  // above: filtering straight to it via `?tags=` guarantees this is the
  // only card in view, regardless of what else the shared workspace-wide
  // `/flashcards` list holds or what other specs seed in parallel.
  const tag = `playwright-fc-edit-${Date.now()}`;
  const front = `Playwright FC Edit Original ${Date.now()}`;
  const back = "Original back text.";
  const updatedFront = `${front} — edited`;

  const { userId } = JSON.parse(fs.readFileSync(SEEDED_USER_FILE, "utf-8")) as { userId: string };
  const db = getDb();
  await createFlashcard(db, { creatorId: userId, front, back, source: "https://example.com", tags: [tag] });

  await page.goto(`/flashcards?tags=${encodeURIComponent(tag)}`);
  await expect(page.getByText(front, { exact: false })).toBeVisible();

  // Opens ticket 02's Modal (a real <dialog> via showModal()) rendering the
  // shared FlashcardForm in edit mode, pre-filled from this card's current
  // values — none of this (native dialog, real form pre-fill) is
  // reproducible under this repo's jsdom-less Vitest, hence Playwright.
  await page.getByRole("button", { name: "Edit flashcard" }).click();
  const heading = page.getByRole("heading", { name: "Edit flashcard" });
  await expect(heading).toBeVisible();
  await expect(page.getByLabel("Question (markdown)")).toHaveValue(front);
  await expect(page.getByLabel("Answer (markdown)")).toHaveValue(back);
  await expect(page.getByRole("button", { name: `Remove tag ${tag}` })).toBeVisible();

  await page.getByLabel("Question (markdown)").fill(updatedFront);
  await page.getByRole("button", { name: "Save" }).click();

  // Saving PATCHes, closes the modal, and refreshes the list (ticket 04's
  // mechanism) rather than patching the row in place.
  await expect(heading).toHaveCount(0);
  await expect(page.getByText(updatedFront, { exact: false })).toBeVisible();
  await expect(page.getByText(front, { exact: true })).toHaveCount(0);

  // Reopening and making an unsaved edit, then Cancel: the form is now
  // dirty, so a native confirm() gates the discard (Modal's confirmClose
  // contract, exercised here via the form's own Cancel button rather than
  // Esc) — accepting it closes without saving.
  await page.getByRole("button", { name: "Edit flashcard" }).click();
  await expect(heading).toBeVisible();
  await page.getByLabel("Question (markdown)").fill("This edit should be discarded");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(heading).toHaveCount(0);
  await expect(page.getByText(updatedFront, { exact: false })).toBeVisible();
  await expect(page.getByText("This edit should be discarded")).toHaveCount(0);

  errors.assertNone();
});

test("flashcard edit dialog's × close button closes a clean form immediately and gates a dirty one, same as Esc/Cancel (ticket 03)", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  const tag = `playwright-fc-close-btn-${Date.now()}`;
  const front = `Playwright FC Close Button ${Date.now()}`;

  const { userId } = JSON.parse(fs.readFileSync(SEEDED_USER_FILE, "utf-8")) as { userId: string };
  const db = getDb();
  await createFlashcard(db, { creatorId: userId, front, back: "Back text.", source: "https://example.com", tags: [tag] });

  await page.goto(`/flashcards?tags=${encodeURIComponent(tag)}`);
  await expect(page.getByText(front, { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Edit flashcard" }).click();
  const heading = page.getByRole("heading", { name: "Edit flashcard" });
  await expect(heading).toBeVisible();
  const closeButton = page.getByRole("button", { name: "Close", exact: true });
  await expect(closeButton).toBeVisible();

  // Clean form: the × closes immediately, no confirm() prompt.
  await closeButton.click();
  await expect(heading).toHaveCount(0);

  // Dirty form: the × routes through the same confirmDiscardChanges() guard
  // as Esc/Cancel — dismissing the confirm() keeps the dialog open...
  await page.getByRole("button", { name: "Edit flashcard" }).click();
  await expect(heading).toBeVisible();
  await page.getByLabel("Question (markdown)").fill("This edit should stay open on dismiss");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(heading).toBeVisible();

  // ...while accepting it discards the edit and closes, same as Cancel/Esc.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(heading).toHaveCount(0);
  await expect(page.getByText("This edit should stay open on dismiss")).toHaveCount(0);

  errors.assertNone();
});

test("flashcards list: each card's Answer starts collapsed and its reveal toggle is independent of every other card's (ticket 01)", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  const tag = `playwright-fc-reveal-${Date.now()}`;
  const frontA = `Reveal Front A ${Date.now()}`;
  const backA = `Reveal Back A ${Date.now()}`;
  const frontB = `Reveal Front B ${Date.now()}`;
  const backB = `Reveal Back B ${Date.now()}`;

  const { userId } = JSON.parse(fs.readFileSync(SEEDED_USER_FILE, "utf-8")) as { userId: string };
  const db = getDb();
  await createFlashcard(db, { creatorId: userId, front: frontA, back: backA, source: "https://example.com", tags: [tag] });
  await createFlashcard(db, { creatorId: userId, front: frontB, back: backB, source: "https://example.com", tags: [tag] });

  await page.goto(`/flashcards?tags=${encodeURIComponent(tag)}`);
  const cardA = page.locator("li", { hasText: frontA });
  const cardB = page.locator("li", { hasText: frontB });
  await expect(cardA).toBeVisible();
  await expect(cardB).toBeVisible();
  // The collapse wrapper itself (not the Answer text): its own box is what
  // the Motion-driven height animation actually resizes to zero (see
  // FlashcardRow.tsx/.module.css), so it's what `toBeVisible()` can reliably
  // tell apart — the `<p>` inside it still has a non-empty box of its own
  // even while its zero-height, overflow:hidden ancestor clips every pixel
  // of it from view.
  const revealWrapA = cardA.locator('[class*="answerRevealInner"]');
  const revealWrapB = cardB.locator('[class*="answerRevealInner"]');

  // Collapsed by default: both Questions show, neither Answer does yet.
  await expect(revealWrapA).not.toBeVisible();
  await expect(revealWrapB).not.toBeVisible();
  await expect(cardA.getByRole("button", { name: "Show answer" })).toBeVisible();

  // Revealing card A's answer leaves card B's untouched.
  await cardA.getByRole("button", { name: "Show answer" }).click();
  await expect(revealWrapA).toBeVisible();
  await expect(cardA.getByText(backA)).toBeVisible();
  await expect(revealWrapB).not.toBeVisible();

  // Hiding it again via the same (now "Hide answer") toggle.
  await cardA.getByRole("button", { name: "Hide answer" }).click();
  await expect(revealWrapA).not.toBeVisible();

  errors.assertNone();
});

test("flashcards list: a card's expand toggle detaches it into a widened overlay, one at a time, dismissible three ways (ticket 02)", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  const tag = `playwright-fc-expand-${Date.now()}`;
  const frontA = `Expand Front A ${Date.now()}`;
  const frontB = `Expand Front B ${Date.now()}`;
  const updatedFrontA = `${frontA} — edited while expanded`;

  const { userId } = JSON.parse(fs.readFileSync(SEEDED_USER_FILE, "utf-8")) as { userId: string };
  const db = getDb();
  await createFlashcard(db, { creatorId: userId, front: frontA, back: "Back A", source: "https://example.com", tags: [tag] });
  await createFlashcard(db, { creatorId: userId, front: frontB, back: "Back B", source: "https://example.com", tags: [tag] });

  await page.goto(`/flashcards?tags=${encodeURIComponent(tag)}`);
  const cardA = page.locator("li", { hasText: frontA });
  const cardB = page.locator("li", { hasText: frontB });
  await expect(cardA).toBeVisible();
  await expect(cardB).toBeVisible();

  const expandToggleA = cardA.getByRole("button", { name: "Expand flashcard" });
  const backdrop = page.locator('[class*="backdrop"]');

  await expandToggleA.click();
  await expect(cardA.getByRole("button", { name: "Collapse flashcard" })).toBeVisible();
  // The other card goes inert while one is expanded.
  await expect(cardB).toHaveAttribute("inert", "");
  await expect(backdrop).toBeVisible();

  // Escape dismisses it and returns focus to the toggle that opened it.
  await page.keyboard.press("Escape");
  await expect(cardA.getByRole("button", { name: "Collapse flashcard" })).toHaveCount(0);
  await expect(cardA.getByRole("button", { name: "Expand flashcard" })).toBeFocused();
  await expect(backdrop).toHaveCount(0);
  await expect(cardB).not.toHaveAttribute("inert", "");

  // Clicking the backdrop dismisses it too.
  await expandToggleA.click();
  await expect(backdrop).toBeVisible();
  await backdrop.click({ position: { x: 5, y: 5 } });
  await expect(backdrop).toHaveCount(0);
  await expect(cardA.getByRole("button", { name: "Expand flashcard" })).toBeVisible();

  // The toggle itself is the third dismissal path.
  await expandToggleA.click();
  await expect(cardA.getByRole("button", { name: "Collapse flashcard" })).toBeVisible();
  await cardA.getByRole("button", { name: "Collapse flashcard" }).click();
  await expect(cardA.getByRole("button", { name: "Expand flashcard" })).toBeVisible();
  await expect(backdrop).toHaveCount(0);

  // Only one card expands at a time: A goes inert the moment B expands (so a
  // real user can't reach A's toggle to stack a second overlay) — this is
  // the single `expandedId` invariant's actual enforcement mechanism, not
  // just a state-model coincidence. Closing B first, then opening A, proves
  // switching which card carries the overlay still works.
  await cardB.getByRole("button", { name: "Expand flashcard" }).click();
  await expect(cardB.getByRole("button", { name: "Collapse flashcard" })).toBeVisible();
  await expect(cardA).toHaveAttribute("inert", "");
  await cardB.getByRole("button", { name: "Collapse flashcard" }).click();
  await expect(cardB.getByRole("button", { name: "Expand flashcard" })).toBeVisible();
  await expect(cardA).not.toHaveAttribute("inert", "");

  await expandToggleA.click();
  await expect(cardA.getByRole("button", { name: "Collapse flashcard" })).toBeVisible();
  await expect(cardB).toHaveAttribute("inert", "");
  // Still exactly one backdrop, not stacked.
  await expect(backdrop).toHaveCount(1);

  // Edit remains usable while the overlay is open. Saving refreshes the
  // list (this repo's established mutation-refresh mechanism, per
  // FlashcardsManager's `refresh`), which also closes the overlay — the
  // same behavior ItemsLibrary's equivalent `refresh` already has for
  // ItemRow, not something new this ticket introduces.
  await cardA.getByRole("button", { name: "Edit flashcard" }).click();
  const heading = page.getByRole("heading", { name: "Edit flashcard" });
  await expect(heading).toBeVisible();
  await page.getByLabel("Question (markdown)").fill(updatedFrontA);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(heading).toHaveCount(0);
  await expect(page.getByText(updatedFrontA, { exact: false })).toBeVisible();
  const updatedCardA = page.locator("li", { hasText: updatedFrontA });
  await expect(updatedCardA.getByRole("button", { name: "Expand flashcard" })).toBeVisible();
  await expect(backdrop).toHaveCount(0);

  errors.assertNone();
});
