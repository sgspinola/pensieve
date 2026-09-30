import { test, expect } from "@playwright/test";

/**
 * Ticket 08: proves error.tsx/wiki/error.tsx actually catch a render crash
 * and swap in the generic fallback after a real render/hydration pass — an
 * HTTP-level check (status code, raw HTML fetch) can't tell a crashed
 * component apart from a healthy one once Next's error boundary has already
 * replaced it, which is exactly why this lives here and not in Vitest.
 *
 * Deliberately doesn't use trackPageErrors (e2e/helpers.ts): the whole point
 * of these tests is an uncaught render exception, which that helper treats
 * as a failure everywhere else.
 *
 * /error-boundary-test and /wiki/error-boundary-test (each throwing
 * unconditionally on render — see their page.tsx) exist solely for this
 * spec; nothing in the app links to them.
 */

test("root error.tsx catches a render crash and shows the generic fallback", async ({ page }) => {
  await page.goto("/error-boundary-test");

  const fallback = page.getByTestId("error-fallback");
  await expect(fallback.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  await expect(
    fallback.getByText("We hit a problem loading this page. Please try again."),
  ).toBeVisible();
  await expect(fallback.getByRole("button", { name: "Try again" })).toBeVisible();

  // No leaked internals: the thrown error's own message never reaches the
  // rendered fallback. (Scoped to our fallback markup, not the whole page —
  // Next's dev-mode overlay legitimately shows the raw message elsewhere,
  // which is expected dev tooling, not something this app rendered.)
  await expect(fallback.getByText(/Boom: intentional crash/)).toHaveCount(0);
});

test("wiki/error.tsx catches a render crash locally, keeping the wiki/app shell mounted", async ({
  page,
}) => {
  await page.goto("/wiki/error-boundary-test");

  const fallback = page.getByTestId("error-fallback");
  await expect(fallback.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
  await expect(
    fallback.getByText("We hit a problem loading this article. Please try again."),
  ).toBeVisible();
  await expect(fallback.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(fallback.getByText(/Boom: intentional crash/)).toHaveCount(0);

  // The boundary is local to the content pane: WikiLayout (persistent
  // header/nav — it calls requireCurrentUser and fetches the article tree
  // itself) stays mounted instead of being replaced by the fallback too —
  // both the app-wide nav and the wiki sidebar's own nav landmark survive.
  await expect(page.getByRole("heading", { name: "PENSIEVE" })).toBeVisible();
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Wiki pages" })).toBeVisible();
});
