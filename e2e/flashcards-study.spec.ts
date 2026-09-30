import "dotenv/config";
import { test, expect } from "@playwright/test";
import { trackPageErrors, addFlashcard } from "./helpers";

test("study session: select a tag, flip a card, advance, and reach the completion screen", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  // A tag unique to this run, attached to exactly two flashcards, so
  // selecting it builds a deterministic two-card deck — enough to exercise
  // [PREVIOUS] (ticket 03's carousel-animated backward navigation) as well
  // as [NEXT], with [NEXT] from the second card still guaranteed to reach
  // the end.
  const tag = `playwright-study-${Date.now()}`;
  const frontA = `Study Front A ${Date.now()}`;
  const backA = `Study Back A ${Date.now()}`;
  const frontB = `Study Front B ${Date.now()}`;
  const backB = `Study Back B ${Date.now()}`;

  await addFlashcard(page, frontA, backA, [tag]);
  await addFlashcard(page, frontB, backB, [tag]);

  await page.goto("/flashcards/study");
  await expect(page.getByRole("heading", { name: "Select tags to study" })).toBeVisible();
  await page.getByRole("button", { name: tag }).click();
  await page.getByRole("button", { name: "Start" }).click();

  // StudySession's Embla carousel mounts the current slide *and* its
  // immediate neighbor simultaneously (both with real Flashcard content —
  // required for Embla's drag/snap math), and only hides the off-screen one
  // via ancestor CSS clipping + a transform, never `display`/`visibility` on
  // the slide itself. Playwright's `isVisible()` is a pure CSS-state check —
  // it can't tell a clipped-off-screen element from a genuinely visible one
  // — so a page-wide `getByText(...).isVisible()` here could just as easily
  // find the off-screen neighbor's front face as the actually-current card's,
  // misbinding which front/back belongs to "card 1" for the rest of this
  // test. `[data-current-slide="true"]` (StudySession.tsx) is a stable,
  // unambiguous hook for the slide that's actually current, driven by the
  // same `isCurrent` boolean the crossfade itself uses — scoping every
  // card-identity query below to it (rather than the page as a whole)
  // sidesteps the false-positive entirely.
  const currentSlide = page.locator('[data-current-slide="true"]');

  // The deck is shuffled, so which card lands first is non-deterministic —
  // whichever front is showing first is "card 1" for the rest of this test.
  const cardAFirst = await currentSlide.getByText(frontA, { exact: false }).isVisible();
  const [firstFront, firstBack, secondFront, secondBack] = cardAFirst
    ? [frontA, backA, frontB, backB]
    : [frontB, backB, frontA, backA];

  await expect(page.getByText("Card 1 of 2", { exact: false })).toBeVisible();

  // [FLIP] now lives in the same row as [PREVIOUS]/[NEXT] rather than on the
  // card itself — asserted structurally (same row, i.e. same vertical
  // position) rather than via a specific pixel offset, so this doesn't
  // couple to layout details beyond "one row."
  const previousBox = await page.getByRole("button", { name: "Previous" }).boundingBox();
  const flipBox = await page.getByRole("button", { name: "Flip" }).boundingBox();
  const nextBox = await page.getByRole("button", { name: "Next", exact: true }).boundingBox();
  expect(previousBox).not.toBeNull();
  expect(flipBox).not.toBeNull();
  expect(nextBox).not.toBeNull();
  expect(Math.abs(previousBox!.y - flipBox!.y)).toBeLessThan(5);
  expect(Math.abs(nextBox!.y - flipBox!.y)).toBeLessThan(5);

  // Front-side-up by default; the central button flips it to reveal the back.
  await expect(currentSlide.getByText(firstFront, { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Flip" }).click();
  await expect(currentSlide.getByText(firstBack, { exact: false })).toBeVisible();
  // Ticket 04 (flip animation): both faces are now mounted at once (for the
  // 3D rotateY animation) rather than swapping content, so this also
  // proves the previously shown face is actually hidden, not just that the
  // new one appeared alongside it.
  await expect(currentSlide.getByText(firstFront, { exact: false })).not.toBeVisible();

  // Flipping back reverses which side is showing.
  await page.getByRole("button", { name: "Show question" }).click();
  await expect(currentSlide.getByText(firstFront, { exact: false })).toBeVisible();
  await expect(currentSlide.getByText(firstBack, { exact: false })).not.toBeVisible();

  // Leave this card flipped before navigating away from it.
  await page.getByRole("button", { name: "Flip" }).click();
  await expect(currentSlide.getByText(firstBack, { exact: false })).toBeVisible();

  // [NEXT] drives the carousel-animated advance (ticket 03) to the second
  // card. Asserting only the settled end state here, per this repo's
  // Vitest/Playwright split — not the transition itself.
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(currentSlide.getByText(secondFront, { exact: false })).toBeVisible();
  await expect(currentSlide.getByText(firstBack, { exact: false })).not.toBeVisible();
  // The incoming card always lands front-side-up, regardless of whether it
  // was left flipped on some earlier visit.
  await expect(currentSlide.getByText(secondBack, { exact: false })).not.toBeVisible();
  await expect(page.getByText("Card 2 of 2", { exact: false })).toBeVisible();

  // [PREVIOUS] (new coverage — ticket 03): mirrors [NEXT]'s carousel
  // animation backward, landing on the first card again. It comes back
  // front-side-up even though it was left flipped, proving a card's
  // flip state resets once navigated away from and revisited.
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(currentSlide.getByText(firstFront, { exact: false })).toBeVisible();
  await expect(currentSlide.getByText(firstBack, { exact: false })).not.toBeVisible();
  await expect(page.getByText("Card 1 of 2", { exact: false })).toBeVisible();

  // Forward again, then off the end of the (now two-card) deck reaches
  // the completion screen exactly as before.
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(currentSlide.getByText(secondFront, { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Session complete" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restart, reshuffled" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pick different tags" })).toBeVisible();

  errors.assertNone();
});

test("study session: a touch-swipe gesture advances and retreats through the deck", async ({ page }) => {
  const errors = trackPageErrors(page);
  const tag = `playwright-swipe-${Date.now()}`;
  const frontA = `Swipe Front A ${Date.now()}`;
  const backA = `Swipe Back A ${Date.now()}`;
  const frontB = `Swipe Front B ${Date.now()}`;
  const backB = `Swipe Back B ${Date.now()}`;

  await addFlashcard(page, frontA, backA, [tag]);
  await addFlashcard(page, frontB, backB, [tag]);

  await page.goto("/flashcards/study");
  await page.getByRole("button", { name: tag }).click();
  await page.getByRole("button", { name: "Start" }).click();

  // Same shuffle-order-is-non-deterministic reasoning, and the same
  // current-slide scoping, as the button-navigation test above.
  const currentSlide = page.locator('[data-current-slide="true"]');
  const cardAFirst = await currentSlide.getByText(frontA, { exact: false }).isVisible();
  const [firstFront, , secondFront] = cardAFirst
    ? [frontA, backA, frontB, backB]
    : [frontB, backB, frontA, backA];

  await expect(page.getByText("Card 1 of 2", { exact: false })).toBeVisible();
  await expect(currentSlide.getByText(firstFront, { exact: false })).toBeVisible();

  // Embla's own drag recognizer (embla-carousel's dragHandler) listens for
  // real native "mousedown"/"touchstart" on the carousel root, not synthetic
  // Pointer Events, and — once a gesture starts — runs the identical
  // threshold/settle logic for both event families. Playwright's
  // `touchscreen` only exposes `tap()` (no drag/swipe primitive), so a real
  // mouse-drag sequence over the card exercises the exact same
  // gesture-recognition code path a touch drag would, without needing
  // `hasTouch: true` on the browser context.
  const viewport = page.locator('[class*="viewport"]');
  const box = await viewport.boundingBox();
  if (!box) throw new Error("Carousel viewport not found for swipe gesture.");
  const rightX = box.x + box.width * 0.8;
  const leftX = box.x + box.width * 0.2;
  const midY = box.y + box.height / 2;

  async function drag(fromX: number, toX: number) {
    await page.mouse.move(fromX, midY);
    await page.mouse.down();
    // Several intermediate steps (not one teleporting jump) so Embla's
    // drag handler sees enough `mousemove` events to recognize a real
    // horizontal drag past its own `dragThreshold` (10px default).
    await page.mouse.move(fromX + (toX - fromX) * 0.5, midY, { steps: 10 });
    await page.mouse.move(toX, midY, { steps: 10 });
    await page.mouse.up();
  }

  // Swiping right-to-left ("swipe left") advances to the next card, same
  // destination as clicking [NEXT].
  await drag(rightX, leftX);
  await expect(currentSlide.getByText(secondFront, { exact: false })).toBeVisible();
  await expect(page.getByText("Card 2 of 2", { exact: false })).toBeVisible();

  // Swiping the other direction ("swipe right") retreats back to the first
  // card, same destination as clicking [PREVIOUS].
  await drag(leftX, rightX);
  await expect(currentSlide.getByText(firstFront, { exact: false })).toBeVisible();
  await expect(page.getByText("Card 1 of 2", { exact: false })).toBeVisible();

  errors.assertNone();
});

test("study session: tag filter search narrows the tag cloud and clear restores it", async ({ page }) => {
  const errors = trackPageErrors(page);
  const tagAlpha = `playwright-filter-alpha-${Date.now()}`;
  const tagBeta = `playwright-filter-beta-${Date.now()}`;

  await addFlashcard(page, `Filter Front Alpha ${Date.now()}`, "Back A", [tagAlpha]);
  await addFlashcard(page, `Filter Front Beta ${Date.now()}`, "Back B", [tagBeta]);

  await page.goto("/flashcards/study");
  await expect(page.getByRole("button", { name: tagAlpha })).toBeVisible();
  await expect(page.getByRole("button", { name: tagBeta })).toBeVisible();

  // Typing filters the tag cloud live, by substring, case-insensitively.
  const filterInput = page.getByLabel("Filter tags");
  await filterInput.fill("ALPHA");
  await expect(page.getByRole("button", { name: tagAlpha })).toBeVisible();
  await expect(page.getByRole("button", { name: tagBeta })).toHaveCount(0);

  // Selecting a tag while filtered, then clearing the filter, must keep the
  // selection intact and restore every tag to view.
  await page.getByRole("button", { name: tagAlpha }).click();
  await page.getByRole("button", { name: "Clear tag filter" }).click();
  await expect(filterInput).toHaveValue("");
  await expect(page.getByRole("button", { name: tagAlpha, pressed: true })).toBeVisible();
  await expect(page.getByRole("button", { name: tagBeta })).toBeVisible();

  // A filter matching nothing shows the "no tags match" message in place of
  // the tag cloud.
  await filterInput.fill("zzz-no-match");
  await expect(page.getByText("No tags match 'zzz-no-match'.")).toBeVisible();
  await expect(page.getByRole("button", { name: tagAlpha })).toHaveCount(0);

  errors.assertNone();
});
