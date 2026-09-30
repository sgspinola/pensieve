import "dotenv/config";
import { test, expect, type Page } from "@playwright/test";
import { trackPageErrors } from "./helpers";

/**
 * Covers the single always-visible Import/Export view (backlog/issues/01)
 * and the copyable sample tab strip that replaced the old "download a
 * sample file" link (backlog/issues/02): no wizard steps, the type picker
 * (a row of radio bullets) starts with nothing checked, Import / Export /
 * file-selection are all present from the start disabled until a kind is
 * picked, and the sample browser is independent of that picker in both
 * directions. Does not assert on parsed entry counts, created/updated
 * records, or exact export/sample file contents beyond a working
 * href/non-empty body — that behavior is already covered in Vitest by the
 * service-layer tests.
 */

const CONTENT_TYPES = ["Flashcards", "Links", "Tools", "Articles"] as const;

async function openModal(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  return page.getByRole("dialog");
}

test("account menu shows Import/Export and opens the modal, not a page navigation", async ({ page }) => {
  const errors = trackPageErrors(page);

  await page.goto("/");
  await page.getByRole("button", { name: /Account menu/ }).click();
  const menuItem = page.getByRole("menuitem", { name: "Import / Export" });
  await expect(menuItem).toBeVisible();

  const urlBeforeClick = page.url();
  await menuItem.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Import / Export" })).toBeVisible();
  expect(page.url()).toBe(urlBeforeClick);

  errors.assertNone();
});

test("modal opens with the type picker unchecked and Import/Export/file controls disabled, and no Back button", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  const dialog = await openModal(page);

  const typeRadios = dialog.getByRole("radio");
  await expect(typeRadios).toHaveCount(CONTENT_TYPES.length);
  for (const radio of await typeRadios.all()) {
    await expect(radio).not.toBeChecked();
  }
  await expect(dialog.locator('input[type="file"]')).toBeDisabled();
  await expect(dialog.getByRole("link", { name: "Export" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: /back/i })).toHaveCount(0);

  errors.assertNone();
});

for (const contentType of CONTENT_TYPES) {
  test(`selecting ${contentType} enables Import, Export, and file-selection at once`, async ({ page }) => {
    const errors = trackPageErrors(page);
    const dialog = await openModal(page);

    await dialog.getByRole("radio", { name: contentType }).check();

    await expect(dialog.locator('input[type="file"]')).toBeEnabled();
    const exportLink = dialog.getByRole("link", { name: "Export" });
    await expect(exportLink).toBeEnabled();
    await expect(exportLink).toHaveAttribute("href", /.+/);

    errors.assertNone();
  });
}

test("Flashcards: select file, see ready count, confirm, see success", async ({ page }) => {
  const errors = trackPageErrors(page);
  const dialog = await openModal(page);

  await dialog.getByRole("radio", { name: "Flashcards" }).check();

  const sample = await (await page.request.get("/api/flashcards/import/sample")).text();
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: "sample.md", mimeType: "text/markdown", buffer: Buffer.from(sample) });

  await expect(dialog.getByText(/Parsed \d+ entr(y|ies)\./)).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm import" }).click();
  await expect(dialog.getByText(/^Done\./)).toBeVisible();

  errors.assertNone();
});

test("sample tab strip is present and independent of the main type picker in both directions", async ({ page }) => {
  const errors = trackPageErrors(page);
  const dialog = await openModal(page);

  const tabStrip = dialog.getByRole("tablist", { name: "Sample content" });
  await expect(tabStrip).toBeVisible();
  for (const label of CONTENT_TYPES) {
    await expect(dialog.getByRole("tab", { name: label })).toBeVisible();
  }

  const articlesRadio = dialog.getByRole("radio", { name: "Articles" });
  await expect(articlesRadio).not.toBeChecked();
  await dialog.getByRole("tab", { name: "Links" }).click();
  await expect(articlesRadio).not.toBeChecked();

  await expect(dialog.getByRole("tab", { name: "Links" })).toHaveAttribute("aria-selected", "true");
  await articlesRadio.check();
  await expect(dialog.getByRole("tab", { name: "Links" })).toHaveAttribute("aria-selected", "true");

  errors.assertNone();
});

test("sample snippet renders a non-empty snippet and a copy affordance", async ({ page, context }) => {
  const errors = trackPageErrors(page);
  const dialog = await openModal(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });

  const snippet = dialog.locator("pre code");
  await expect(snippet).not.toBeEmpty();
  await expect(snippet).not.toHaveText("Loading…");

  const copyButton = dialog.getByRole("button", { name: "Copy" });
  await expect(copyButton).toBeVisible();
  await copyButton.click();
  await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();

  errors.assertNone();
});
