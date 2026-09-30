import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { flashcards, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ValidationError } from "@/services/errors";
import { getFlashcardTagNames } from "@/services/tags/tags";
import {
  buildFlashcardImportSample,
  importFlashcardsFile,
  parseFlashcardsImportFile,
} from "@/services/flashcards/flashcards-import";

const TWO_ENTRY_FILE = [
  "---",
  "front: What is TCP?",
  "tags:",
  "  - networking",
  "source: https://example.com/tcp",
  "---",
  "",
  "A connection-oriented transport protocol.",
  "",
  "",
  "---",
  "front: What is UDP?",
  "tags:",
  "  - networking",
  "source: https://example.com/udp",
  "---",
  "",
  "A connectionless transport protocol.",
  "",
].join("\n");

// A larger, realistically shaped file: unindented block-list tags, a quoted
// front containing a colon, and bodies with paragraphs, bullet/numbered
// lists and a fenced code block — the formatting variety real exports have.
const LARGE_ENTRY_COUNT = 45;
const LARGE_FILE = Array.from({ length: LARGE_ENTRY_COUNT }, (_, i) =>
  [
    "---",
    i === 0 ? "front: 'Question 1: why quote a front with a colon?'" : `front: Question ${i + 1}?`,
    "tags:",
    "- Synthetic",
    `- Group ${i % 5}`,
    `source: https://example.com/cards/${i + 1}`,
    "---",
    "",
    `Answer ${i + 1}, first paragraph.`,
    "",
    "- first bullet",
    "- second bullet",
    "",
    "1. numbered step",
    "2. another step",
    ...(i === 1 ? ["", "```yaml", "key: value", "```"] : []),
    "",
  ].join("\n"),
).join("\n\n");

describe("parseFlashcardsImportFile", () => {
  it("parses a multi-entry file into front/tags/source/back entries", () => {
    const entries = parseFlashcardsImportFile(TWO_ENTRY_FILE);

    expect(entries).toEqual([
      { front: "What is TCP?", tags: ["networking"], source: "https://example.com/tcp", back: "A connection-oriented transport protocol." },
      { front: "What is UDP?", tags: ["networking"], source: "https://example.com/udp", back: "A connectionless transport protocol." },
    ]);
  });

  it("parses a large, varied multi-entry file into one entry per card", () => {
    const entries = parseFlashcardsImportFile(LARGE_FILE);
    expect(entries).toHaveLength(LARGE_ENTRY_COUNT);
    expect(entries[0].front).toBe("Question 1: why quote a front with a colon?");
    expect(entries[1].back).toContain("key: value");
    for (const entry of entries) {
      expect(entry.front.length).toBeGreaterThan(0);
      expect(entry.source.length).toBeGreaterThan(0);
      expect(entry.back.length).toBeGreaterThan(0);
    }
  });

  it("rejects the whole file when one entry is missing front", () => {
    const raw = [
      "---",
      "front: Good entry",
      "source: https://example.com",
      "tags:",
      "  - ok",
      "---",
      "",
      "Body.",
      "",
      "",
      "---",
      "source: https://example.com",
      "tags:",
      "  - ok",
      "---",
      "",
      "Body without a front.",
      "",
    ].join("\n");

    expect(() => parseFlashcardsImportFile(raw)).toThrow(ValidationError);
  });

  it("rejects the whole file when one entry is missing source", () => {
    const raw = [
      "---",
      "front: Missing source",
      "---",
      "",
      "Body.",
      "",
    ].join("\n");

    expect(() => parseFlashcardsImportFile(raw)).toThrow(ValidationError);
  });

  it("rejects the whole file when one entry has an empty body", () => {
    const raw = ["---", "front: Empty body", "source: https://example.com", "---", ""].join("\n");

    expect(() => parseFlashcardsImportFile(raw)).toThrow(ValidationError);
  });

  it("rejects input the splitter itself can't partition", () => {
    expect(() => parseFlashcardsImportFile("not a frontmatter file at all")).toThrow(ValidationError);
  });

  it("rejects a tags field that isn't a list of strings, matching the manual-create API's own rule", () => {
    const raw = ["---", "front: Q", "source: https://example.com", "tags: not-a-list", "---", "", "A.", ""].join(
      "\n",
    );

    expect(() => parseFlashcardsImportFile(raw)).toThrow(ValidationError);
  });

  it("rejects an entry whose frontmatter has no `tags:` key at all (ticket 04: mandatory tags)", () => {
    const raw = ["---", "front: Q", "source: https://example.com", "---", "", "A.", ""].join("\n");

    expect(() => parseFlashcardsImportFile(raw)).toThrow(ValidationError);
    expect(() => parseFlashcardsImportFile(raw)).toThrow(/tags/i);
  });

  it("rejects an entry with an explicit empty tags list (ticket 04)", () => {
    const raw = ["---", "front: Q", "source: https://example.com", "tags: []", "---", "", "A.", ""].join("\n");

    expect(() => parseFlashcardsImportFile(raw)).toThrow(ValidationError);
  });

  it("rejects an entry whose tags are all blank/whitespace-only (ticket 04)", () => {
    const raw = [
      "---",
      "front: Q",
      "source: https://example.com",
      'tags: ["", "   "]',
      "---",
      "",
      "A.",
      "",
    ].join("\n");

    expect(() => parseFlashcardsImportFile(raw)).toThrow(ValidationError);
  });

  it("names the offending entry number when a later entry in a multi-entry file is missing tags", () => {
    const raw = [
      "---",
      "front: Good entry",
      "source: https://example.com",
      "tags:",
      "  - ok",
      "---",
      "",
      "Body.",
      "",
      "",
      "---",
      "front: Bad entry",
      "source: https://example.com",
      "---",
      "",
      "Body without tags.",
      "",
    ].join("\n");

    expect(() => parseFlashcardsImportFile(raw)).toThrow(/Entry 2/);
  });
});

describe("buildFlashcardImportSample", () => {
  it("produces a two-entry file that parseFlashcardsImportFile itself accepts", () => {
    const sample = buildFlashcardImportSample();
    const entries = parseFlashcardsImportFile(sample);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.front.length).toBeGreaterThan(0);
      expect(entry.source.length).toBeGreaterThan(0);
      expect(entry.back.length).toBeGreaterThan(0);
    }
  });
});

describe("importFlashcardsFile", () => {
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

  it("creates a new card per entry in a clean multi-entry import, attributed to the importing member", async () => {
    const importer = await seedUser("Importer");

    const result = await importFlashcardsFile(db, TWO_ENTRY_FILE, importer);

    expect(result).toEqual({ created: 2, updated: 0 });
    const rows = await db.select().from(flashcards);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.createdBy === importer)).toBe(true);
    const tcp = rows.find((row) => row.front === "What is TCP?")!;
    expect(await getFlashcardTagNames(db, tcp.id)).toEqual(["networking"]);
  });

  it("updates the matching card in place (by frontHash) on a re-import with one edited answer, rather than duplicating it", async () => {
    const original = await seedUser("Original Importer");
    await importFlashcardsFile(db, TWO_ENTRY_FILE, original);

    const editedFile = TWO_ENTRY_FILE.replace(
      "A connection-oriented transport protocol.",
      "A connection-oriented transport protocol (edited).",
    );
    const reimporter = await seedUser("Re-importer");
    const result = await importFlashcardsFile(db, editedFile, reimporter);

    expect(result).toEqual({ created: 0, updated: 2 });
    const rows = await db.select().from(flashcards);
    expect(rows).toHaveLength(2);
    const tcp = rows.find((row) => row.front === "What is TCP?")!;
    expect(tcp.back).toBe("A connection-oriented transport protocol (edited).");
    expect(tcp.createdBy).toBe(reimporter);
  });

  it("rejects the whole import with zero rows written when one entry is malformed", async () => {
    const importer = await seedUser("Importer");
    const raw = [
      "---",
      "front: Good entry",
      "source: https://example.com",
      "tags:",
      "  - ok",
      "---",
      "",
      "Good body.",
      "",
      "",
      "---",
      "front: Bad entry",
      "---",
      "",
      "Missing source.",
      "",
    ].join("\n");

    await expect(importFlashcardsFile(db, raw, importer)).rejects.toThrow(ValidationError);
    const rows = await db.select().from(flashcards);
    expect(rows).toHaveLength(0);
  });

  it("imports a large, varied multi-entry file as all-new cards", async () => {
    const importer = await seedUser("Importer");

    const result = await importFlashcardsFile(db, LARGE_FILE, importer);

    expect(result).toEqual({ created: LARGE_ENTRY_COUNT, updated: 0 });
    const rows = await db.select().from(flashcards);
    expect(rows).toHaveLength(LARGE_ENTRY_COUNT);
  });

  it("does not create a new card when the front differs only by surrounding whitespace, matching the trim-only rule", async () => {
    const importer = await seedUser("Importer");
    await importFlashcardsFile(db, TWO_ENTRY_FILE, importer);

    const paddedFile = TWO_ENTRY_FILE.replace("front: What is TCP?", "front: '  What is TCP?  '");
    const result = await importFlashcardsFile(db, paddedFile, importer);

    expect(result.updated).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(flashcards).where(eq(flashcards.front, "  What is TCP?  "));
    expect(rows).toHaveLength(0);
  });
});
