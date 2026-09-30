import fs from "node:fs";
import "dotenv/config";
import { test, expect } from "@playwright/test";
import { getDb } from "../src/db/client";
import { createItem } from "../src/services/items/items";
import { SEEDED_USER_FILE } from "./global-setup";
import { trackPageErrors } from "./helpers";

test("can create a wiki page and see it rendered in /wiki", async ({ page }) => {
  const errors = trackPageErrors(page);
  const title = `Playwright Smoke Page ${Date.now()}`;
  const content = "Smoke test content with **bold** markdown.";

  // Wiki pages are never a content type on `/items/new` (the library
  // excludes them entirely) — `/wiki`'s own "+ New page" is the only way to
  // create one.
  await page.goto("/wiki");
  await page.getByRole("button", { name: "+ New page" }).click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.locator("#item-form-content").fill(content);
  await page.getByRole("button", { name: "Add item" }).click();
  await page.waitForURL(/\/wiki\/.+/);

  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  // Rendered markdown, not the raw "**bold**" source — proves MarkdownBlock
  // (a client component pulled into a Server Component page) actually
  // hydrated and rendered instead of crashing.
  await expect(page.locator("article, main").getByText("bold", { exact: false })).toBeVisible();

  errors.assertNone();
});

test("wiki's '+ New page' button opens the form in the content pane, not the sidebar", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  const title = `Playwright Sidebar Page ${Date.now()}`;
  const content = "Created from the wiki sidebar's New page button.";

  await page.goto("/wiki");
  await page.getByRole("button", { name: "+ New page" }).click();

  // The form's Title field must land inside the content pane (the sibling
  // of the <nav aria-label="Wiki pages"> sidebar), not inside the
  // sidebar's own narrow column — this is the WikiShell state-lifting this
  // change relies on to move AddItemForm out of the sidebar.
  const sidebar = page.getByRole("navigation", { name: "Wiki pages" });
  await expect(sidebar.getByLabel("Title", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Title", { exact: true })).toBeVisible();

  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.locator("#item-form-content").fill(content);
  await page.getByRole("button", { name: "Add item" }).click();

  await page.waitForURL(/\/wiki\/.+/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  errors.assertNone();
});

test("wiki's 'Add & add another' clears the form in place instead of navigating to the new page", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  const title = `Playwright Add Another ${Date.now()}`;

  await page.goto("/wiki");
  await page.getByRole("button", { name: "+ New page" }).click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.locator("#item-form-content").fill("Content for the add-another smoke test.");
  await page.getByRole("button", { name: "Add & add another" }).click();

  // Stays on /wiki with the creation panel still open and cleared, rather
  // than the onSuccess navigate-to-the-new-page behavior "Add item" (the
  // other submit button) triggers.
  await expect(page).toHaveURL(/\/wiki$/);
  await expect(page.getByText("Item added.")).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("");
  // The sidebar tree refreshed to include the page just added.
  const sidebar = page.getByRole("navigation", { name: "Wiki pages" });
  await expect(sidebar.getByRole("link", { name: title })).toBeVisible();
  // The still-mounted Parent page dropdown refetched too, so the page
  // just added is selectable as a parent for the next one without a reload.
  await expect(page.getByLabel("Parent page").getByRole("option", { name: title })).toHaveCount(1);

  errors.assertNone();
});

test("deleting a page refreshes both the sidebar tree and the content pane", async ({ page }) => {
  const errors = trackPageErrors(page);
  const title = `Playwright Delete Refresh ${Date.now()}`;

  await page.goto("/wiki");
  await page.getByRole("button", { name: "+ New page" }).click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.locator("#item-form-content").fill("Content for the delete-refresh smoke test.");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.waitForURL(/\/wiki\/.+/);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await page.waitForURL(/\/wiki$/);
  await expect(page.getByText("Select a page from the sidebar, or create a new one.")).toBeVisible();
  const sidebar = page.getByRole("navigation", { name: "Wiki pages" });
  await expect(sidebar.getByRole("link", { name: title })).toHaveCount(0);

  errors.assertNone();
});

test("wiki pages are excluded from the library list/search, even when a kind=page URL is forced", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  const tag = `playwright-item-wiki-excluded-${Date.now()}`;
  const title = `Playwright Wiki Excluded ${Date.now()}`;
  const content = "A wiki page that should never surface in the library.";

  const { userId } = JSON.parse(fs.readFileSync(SEEDED_USER_FILE, "utf-8")) as { userId: string };
  const db = getDb();
  await createItem(db, { creatorId: userId, kind: "page", title, content, tags: [tag] });

  // A hand-crafted `?kind=page` is stripped server-side (see page.tsx's
  // `isLibraryItemKind` filtering) rather than honored — there is no way to
  // bring a wiki page into this view, and the "wiki" chip that used to allow
  // it is gone entirely.
  await page.goto(`/?kind=page&tags=${encodeURIComponent(tag)}`);
  await expect(page.getByText(title, { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Wiki" })).toHaveCount(0);

  // Nor is it offered as a kind when adding a new item from the library.
  await page.goto("/items/new");
  await expect(page.getByRole("radio", { name: "Wiki page" })).toHaveCount(0);

  errors.assertNone();
});
