import { test, expect } from "@playwright/test";
import { trackPageErrors } from "./helpers";

/**
 * Smoke coverage for the light/dark toggle added by the Technical Precision
 * redesign: proves the toggle actually flips `data-theme` on `<html>` (and a
 * real computed style, not just the attribute) and that the choice survives
 * a reload — i.e. the `theme` cookie round-trip works, not just the
 * in-memory DOM mutation. Exact colors/spacing are a visual concern, not
 * something this smoke spec asserts on.
 */
test("theme toggle flips data-theme, updates rendered color, and persists across reload", async ({ page }) => {
  const errors = trackPageErrors(page);

  await page.goto("/");

  const html = page.locator("html");
  // No cookie yet in a fresh context: defaults to dark, matching the app's
  // previous hardcoded-dark behavior.
  await expect(html).toHaveAttribute("data-theme", "dark");
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Light mode" }).click();

  await expect(html).toHaveAttribute("data-theme", "light");
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .not.toBe(darkBackground);

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");

  errors.assertNone();
});
