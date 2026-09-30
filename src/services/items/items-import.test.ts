import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { items, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ValidationError } from "@/services/errors";
import { getItemTagNames } from "@/services/tags/tags";
import { buildItemImportSample, importItemsFile, parseItemsImportFile } from "@/services/items/items-import";

const TWO_ENTRY_FILE = [
  "---",
  "title: Kubernetes RBAC",
  "url: https://example.com/rbac",
  "tags:",
  "  - kubernetes",
  "description: A deep dive into RBAC.",
  "---",
  "",
  "Worth re-reading.",
  "",
  "",
  "---",
  "title: Another Link",
  "url: https://example.com/other",
  "tags: []",
  "---",
  "",
  "Some notes.",
  "",
].join("\n");

describe("parseItemsImportFile", () => {
  it("parses a multi-entry file into title/url/tags/description/notes entries", () => {
    const entries = parseItemsImportFile(TWO_ENTRY_FILE);

    expect(entries).toEqual([
      {
        title: "Kubernetes RBAC",
        url: "https://example.com/rbac",
        tags: ["kubernetes"],
        description: "A deep dive into RBAC.",
        notes: "Worth re-reading.",
      },
      {
        title: "Another Link",
        url: "https://example.com/other",
        tags: [],
        description: null,
        notes: "Some notes.",
      },
    ]);
  });

  it("rejects the whole file when one entry is missing/blank title", () => {
    const raw = [
      "---",
      "title: Good entry",
      "url: https://example.com",
      "---",
      "",
      "Notes.",
      "",
      "",
      "---",
      "title: '  '",
      "url: https://example.com/2",
      "---",
      "",
      "Notes.",
      "",
    ].join("\n");

    expect(() => parseItemsImportFile(raw)).toThrow(ValidationError);
  });

  it("rejects the whole file when one entry is missing/blank url (ticket 07)", () => {
    const raw = [
      "---",
      "title: Good entry",
      "url: https://example.com",
      "---",
      "",
      "Notes.",
      "",
      "",
      "---",
      "title: Missing url",
      "---",
      "",
      "Notes.",
      "",
    ].join("\n");

    expect(() => parseItemsImportFile(raw)).toThrow(ValidationError);
  });

  it("parses using whichever fields are given regardless of which kind the caller will use them for", () => {
    // No per-entry "kind" field exists at all — the file only ever has
    // title/url/tags/description/notes, the same shape for link, tool, or
    // article; which kind these become is chosen in the modal, not read
    // from the file.
    const entries = parseItemsImportFile(TWO_ENTRY_FILE);
    expect(entries).toHaveLength(2);
  });

  it("rejects input the splitter itself can't partition", () => {
    expect(() => parseItemsImportFile("not a frontmatter file at all")).toThrow(ValidationError);
  });

  it("rejects a tags field that isn't a list of strings", () => {
    const raw = ["---", "title: Q", "url: https://example.com", "tags: not-a-list", "---", "", "Notes.", ""].join(
      "\n",
    );
    expect(() => parseItemsImportFile(raw)).toThrow(ValidationError);
  });
});

describe("buildItemImportSample", () => {
  it.each(["link", "tool", "article"] as const)(
    "produces a two-entry %s sample that parseItemsImportFile itself accepts",
    (kind) => {
      const sample = buildItemImportSample(kind);
      const entries = parseItemsImportFile(sample);
      expect(entries).toHaveLength(2);
      for (const entry of entries) {
        expect(entry.title.length).toBeGreaterThan(0);
        expect(entry.url.length).toBeGreaterThan(0);
      }
    },
  );
});

describe("importItemsFile", () => {
  let db: TestDatabase;
  let teardown: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const testDb = await createTestDb();
    db = testDb.db;
    teardown = testDb.teardown;
  });

  afterEach(async () => {
    if (!teardown) return;
    const cleanup = teardown;
    teardown = undefined;
    await cleanup();
  });

  async function seedUser(displayName: string): Promise<string> {
    const [row] = await db.insert(users).values({ displayName, role: "member" }).returning();
    return row.id;
  }

  it("creates a new item per entry of the given kind, attributed to the importing member", async () => {
    const importer = await seedUser("Importer");

    const result = await importItemsFile(db, TWO_ENTRY_FILE, "link", importer);

    expect(result).toEqual({ created: 2 });
    const rows = await db.select().from(items).where(eq(items.kind, "link"));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.createdBy === importer)).toBe(true);
    const rbac = rows.find((row) => row.title === "Kubernetes RBAC")!;
    expect(await getItemTagNames(db, rbac.id)).toEqual(["kubernetes"]);
  });

  it("imports entries as whichever kind the caller specifies, e.g. article", async () => {
    const importer = await seedUser("Importer");

    await importItemsFile(db, TWO_ENTRY_FILE, "article", importer);

    const rows = await db.select().from(items);
    expect(rows.every((row) => row.kind === "article")).toBe(true);
  });

  it("never matches/updates an existing item — always creates new rows, unlike the flashcard importer", async () => {
    const importer = await seedUser("Importer");
    await importItemsFile(db, TWO_ENTRY_FILE, "link", importer);

    const result = await importItemsFile(db, TWO_ENTRY_FILE, "link", importer);

    expect(result).toEqual({ created: 2 });
    const rows = await db.select().from(items).where(eq(items.kind, "link"));
    expect(rows).toHaveLength(4);
  });

  it("rejects the whole import with zero rows written when one entry has a blank title", async () => {
    const importer = await seedUser("Importer");
    const raw = [
      "---",
      "title: Good entry",
      "url: https://example.com",
      "---",
      "",
      "Notes.",
      "",
      "",
      "---",
      "title: ''",
      "url: https://example.com/2",
      "---",
      "",
      "Notes.",
      "",
    ].join("\n");

    await expect(importItemsFile(db, raw, "link", importer)).rejects.toThrow(ValidationError);
    const rows = await db.select().from(items);
    expect(rows).toHaveLength(0);
  });
});
