import { expect, type Page } from "@playwright/test";

/**
 * Fails the test on any uncaught client-side exception (e.g. a Server
 * Component that needed "use client" and crashed on render) or server error
 * page — the class of bug that curl/HTTP-level verification can't see,
 * since it only exists once React actually hydrates in a real browser. This
 * is exactly the gap that motivated adding Playwright: ticket 06 of the
 * wiki-article-hierarchy feature shipped `MarkdownBlock` without "use
 * client" and it only surfaced once something actually rendered `/wiki/[id]`
 * in a browser-shaped environment. Shared by every spec file (ticket 08
 * extracted this out of smoke.spec.ts, which defined it first, so a future
 * change to what counts as a tracked error only has to be made once).
 */
export function trackPageErrors(page: Page): { assertNone: () => void } {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return {
    assertNone: () => expect(errors, `Uncaught client-side error(s): ${errors.join("; ")}`).toEqual([]),
  };
}

/**
 * Generalized from (ticket 03) near-identical copies that used to live
 * inline in individual smoke.spec.ts tests: some hardcoded a single tag via
 * closure, one took it as a parameter, and one took no tag at all — `tags`
 * covers all of those call shapes as an optional list.
 */
export async function addFlashcard(page: Page, front: string, back: string, tags?: string[]) {
  await page.goto("/flashcards/new");
  await page.locator("#flashcard-front").fill(front);
  await page.locator("#flashcard-back").fill(back);
  await page.locator("#flashcard-source").fill("https://example.com");
  for (const tag of tags ?? []) {
    await page.getByLabel("Tags").fill(tag);
    await page.getByLabel("Tags").press("Enter");
  }
  await page.getByRole("button", { name: "Add flashcard" }).click();
  await page.waitForURL(/\/flashcards$/);
  // Every spec shares one seeded user, and import-export.spec.ts bulk-imports
  // hundreds of sample cards for it in parallel. The unfiltered list shows
  // only the newest page, so a card added just before that import lands can
  // fall off it. A run-unique tag's filtered list can't be crowded out.
  if (tags?.length) {
    await page.goto(`/flashcards?tags=${encodeURIComponent(tags[0])}`);
  }
  await expect(page.getByText(front, { exact: false })).toBeVisible();
}

/** Generalized from the local copy in smoke.spec.ts's library tag-search test (ticket 03). */
export async function addLinkWithTag(page: Page, url: string, tag: string) {
  await page.goto("/items/new");
  // The form defaults to Tool; a "link with tag" should actually be a Link.
  await page.getByRole("radio", { name: "Link" }).click();
  await page.getByLabel("URL").fill(url);
  await page.getByLabel("Title", { exact: true }).fill(url);
  await page.getByLabel("Tags").fill(tag);
  await page.getByLabel("Tags").press("Enter");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.waitForURL("/");
  await expect(page.getByRole("link", { name: url })).toBeVisible();
}
