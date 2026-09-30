import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { users } from "@/db/schema";
import { splitFrontmatterEntries } from "@/lib/frontmatter-file";
import { createFlashcard } from "@/services/flashcards/flashcards";
import { exportFlashcardsFile } from "@/services/flashcards/flashcards-export";
import { setFlashcardTags } from "@/services/tags/tags";

describe("exportFlashcardsFile", () => {
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

  async function seedUser(): Promise<string> {
    const [row] = await db.insert(users).values({ displayName: "Alice", role: "member" }).returning();
    return row.id;
  }

  it("produces an empty file for a workspace with no flashcards", async () => {
    const file = await exportFlashcardsFile(db);
    expect(file.trim()).toBe("");
  });

  it("round-trips a single flashcard's front/tags/source frontmatter and back body through gray-matter", async () => {
    const creatorId = await seedUser();
    await createFlashcard(db, {
      creatorId,
      front: "What is TCP?",
      back: "A connection-oriented transport protocol.",
      source: "https://example.com/tcp",
      tags: ["networking", "tcp"],
    });

    const file = await exportFlashcardsFile(db);
    const { data, content } = matter(file);

    expect(data).toEqual({
      front: "What is TCP?",
      tags: ["networking", "tcp"],
      source: "https://example.com/tcp",
    });
    expect(content.trim()).toBe("A connection-oriented transport protocol.");
  });

  it("includes every flashcard in the workspace, not just the current member's", async () => {
    const alice = await seedUser();
    const bob = await seedUser();
    await createFlashcard(db, { creatorId: alice, front: "Q1", back: "A1", source: "https://example.com/1", tags: ["general"] });
    await createFlashcard(db, { creatorId: bob, front: "Q2", back: "A2", source: "https://example.com/2", tags: ["general"] });

    const file = await exportFlashcardsFile(db);
    const chunks = splitFrontmatterEntries(file);
    expect(chunks).toHaveLength(2);

    const fronts = chunks
      .map((chunk) => matter(`${chunk.frontmatterBlock}\n${chunk.body}`).data.front)
      .sort();
    expect(fronts).toEqual(["Q1", "Q2"]);
  });

  it("produces a multi-entry file that ticket 01's splitter partitions back into the same number of chunks", async () => {
    const creatorId = await seedUser();
    for (let i = 0; i < 5; i++) {
      const card = await createFlashcard(db, {
        creatorId,
        front: `Question ${i}`,
        back: `Answer ${i}.\n\nWith a second line.`,
        source: `https://example.com/${i}`,
        tags: ["even"],
      });
      // createFlashcard now requires at least one tag (ticket 04), so the
      // odd-index (intentionally tagless, to exercise the export's empty-
      // tags-array rendering) cards are cleared via setFlashcardTags
      // directly, bypassing that create-time requirement.
      if (i % 2 !== 0) {
        await setFlashcardTags(db, card.id, []);
      }
    }

    const file = await exportFlashcardsFile(db);
    const chunks = splitFrontmatterEntries(file);
    expect(chunks).toHaveLength(5);

    for (const chunk of chunks) {
      const { data, content } = matter(`${chunk.frontmatterBlock}\n${chunk.body}`);
      const index = Number((data.front as string).replace("Question ", ""));
      expect(content.trim()).toBe(`Answer ${index}.\n\nWith a second line.`);
      expect(data.tags).toEqual(index % 2 === 0 ? ["even"] : []);
    }
  });

  it("gives a tagless card an empty tags array in its frontmatter, not a missing field", async () => {
    const creatorId = await seedUser();
    const card = await createFlashcard(db, { creatorId, front: "Q", back: "A", source: "https://example.com", tags: ["temp"] });
    // createFlashcard now requires at least one tag (ticket 04); clear it
    // via setFlashcardTags directly to exercise a tagless card, same as
    // above.
    await setFlashcardTags(db, card.id, []);

    const file = await exportFlashcardsFile(db);
    const { data } = matter(file);
    expect(data.tags).toEqual([]);
  });
});
