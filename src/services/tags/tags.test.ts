import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { items, tags, users } from "@/db/schema";
import { useTestLogSink } from "@/test/log-sink";
import {
  getFlashcardTagNames,
  getItemTagNames,
  listFlashcardTags,
  listLibraryTags,
  listTags,
  normalizeTagName,
  setFlashcardTags,
  setItemTags,
} from "@/services/tags/tags";
import { createFlashcard } from "@/services/flashcards/flashcards";

describe("tags service", () => {
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

  describe("normalizeTagName", () => {
    it("trims leading/trailing whitespace and lowercases", () => {
      expect(normalizeTagName("  Machine Learning  ")).toBe("machine learning");
    });

    it("collapses repeated internal whitespace to a single space", () => {
      expect(normalizeTagName("machine    learning")).toBe("machine learning");
    });
  });

  describe("listTags", () => {
    it("returns an empty list when no tags exist yet", async () => {
      expect(await listTags(db)).toEqual([]);
    });

    it("returns every existing tag name, alphabetically", async () => {
      const alice = await seedUser();
      const item = await seedItem(alice);
      await setItemTags(db, item.id, ["Networking", "cryptography"]);

      expect(await listTags(db)).toEqual(["cryptography", "networking"]);
    });
  });

  describe("listLibraryTags", () => {
    it("returns an empty list when no tags exist yet", async () => {
      expect(await listLibraryTags(db)).toEqual([]);
    });

    it("returns a tag used by a non-page item, same as listTags", async () => {
      const alice = await seedUser();
      const link = await seedItem(alice, "link");
      await setItemTags(db, link.id, ["networking"]);

      expect(await listLibraryTags(db)).toEqual(["networking"]);
    });

    it("drops a tag used exclusively by a wiki page", async () => {
      const alice = await seedUser();
      const page = await seedItem(alice, "page");
      await setItemTags(db, page.id, ["wiki-only"]);

      expect(await listTags(db)).toEqual(["wiki-only"]);
      expect(await listLibraryTags(db)).toEqual([]);
    });

    it("keeps a tag used by both a wiki page and a non-page item", async () => {
      const alice = await seedUser();
      const page = await seedItem(alice, "page");
      const link = await seedItem(alice, "link");
      await setItemTags(db, page.id, ["shared"]);
      await setItemTags(db, link.id, ["shared"]);

      expect(await listLibraryTags(db)).toEqual(["shared"]);
    });

    it("drops a tag not attached to any item at all (e.g. flashcard-only, ticket 05)", async () => {
      const alice = await seedUser();
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q", back: "A", source: "https://example.com", tags: ["seed"] });
      await setFlashcardTags(db, card.id, ["flashcard-only"]);

      expect(await listLibraryTags(db)).toEqual([]);
    });

    it("keeps a tag used by both a non-page item and a flashcard", async () => {
      const alice = await seedUser();
      const link = await seedItem(alice, "link");
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q", back: "A", source: "https://example.com", tags: ["seed"] });
      await setItemTags(db, link.id, ["shared"]);
      await setFlashcardTags(db, card.id, ["shared"]);

      expect(await listLibraryTags(db)).toEqual(["shared"]);
    });
  });

  describe("listFlashcardTags (ticket 05)", () => {
    it("returns an empty list when no tags exist yet", async () => {
      expect(await listFlashcardTags(db)).toEqual([]);
    });

    it("returns a tag attached to at least one flashcard", async () => {
      const alice = await seedUser();
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q", back: "A", source: "https://example.com", tags: ["networking"] });
      void card;

      expect(await listFlashcardTags(db)).toEqual(["networking"]);
    });

    it("drops a tag that is only attached to an item, never a flashcard", async () => {
      const alice = await seedUser();
      const link = await seedItem(alice, "link");
      await setItemTags(db, link.id, ["item-only"]);

      expect(await listTags(db)).toEqual(["item-only"]);
      expect(await listFlashcardTags(db)).toEqual([]);
    });

    it("keeps a tag used by both an item and a flashcard", async () => {
      const alice = await seedUser();
      const link = await seedItem(alice, "link");
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q", back: "A", source: "https://example.com", tags: ["seed"] });
      await setItemTags(db, link.id, ["shared"]);
      await setFlashcardTags(db, card.id, ["shared"]);

      expect(await listFlashcardTags(db)).toEqual(["shared"]);
    });

    it("returns tags alphabetically", async () => {
      const alice = await seedUser();
      const card = await createFlashcard(db, {
        creatorId: alice.id,
        front: "Q",
        back: "A",
        source: "https://example.com",
        tags: ["zebra", "apple"],
      });
      void card;

      expect(await listFlashcardTags(db)).toEqual(["apple", "zebra"]);
    });
  });

  describe("setItemTags / getItemTagNames", () => {
    it("attaches tags to an item", async () => {
      const alice = await seedUser();
      const item = await seedItem(alice);

      await setItemTags(db, item.id, ["ctf", "web"]);

      expect(await getItemTagNames(db, item.id)).toEqual(["ctf", "web"]);
    });

    it("removes tags no longer in the set on a subsequent call", async () => {
      const alice = await seedUser();
      const item = await seedItem(alice);
      await setItemTags(db, item.id, ["ctf", "web"]);

      await setItemTags(db, item.id, ["web"]);

      expect(await getItemTagNames(db, item.id)).toEqual(["web"]);
    });

    it("clears all tags when given an empty list", async () => {
      const alice = await seedUser();
      const item = await seedItem(alice);
      await setItemTags(db, item.id, ["ctf"]);

      await setItemTags(db, item.id, []);

      expect(await getItemTagNames(db, item.id)).toEqual([]);
    });

    it("reuses an existing tag row by case/whitespace-insensitive name instead of creating a duplicate", async () => {
      const alice = await seedUser();
      const first = await seedItem(alice);
      const second = await seedItem(alice);

      await setItemTags(db, first.id, ["Web Security"]);
      await setItemTags(db, second.id, ["  web   security  "]);

      const allTags = await db.select().from(tags);
      expect(allTags).toHaveLength(1);
      expect(allTags[0].name).toBe("web security");
      expect(await getItemTagNames(db, first.id)).toEqual(["web security"]);
      expect(await getItemTagNames(db, second.id)).toEqual(["web security"]);
    });

    it("ignores blank/whitespace-only tag names", async () => {
      const alice = await seedUser();
      const item = await seedItem(alice);

      await setItemTags(db, item.id, ["real", "   ", ""]);

      expect(await getItemTagNames(db, item.id)).toEqual(["real"]);
    });

    it("deduplicates tag names that normalize to the same value within one call", async () => {
      const alice = await seedUser();
      const item = await seedItem(alice);

      await setItemTags(db, item.id, ["Rust", "rust", "  RUST "]);

      expect(await getItemTagNames(db, item.id)).toEqual(["rust"]);
    });

    it("scopes tags to their own item — attaching to one item doesn't affect another", async () => {
      const alice = await seedUser();
      const first = await seedItem(alice);
      const second = await seedItem(alice);

      await setItemTags(db, first.id, ["shared", "only-first"]);
      await setItemTags(db, second.id, ["shared", "only-second"]);

      expect(await getItemTagNames(db, first.id)).toEqual(["only-first", "shared"]);
      expect(await getItemTagNames(db, second.id)).toEqual(["only-second", "shared"]);
    });

    it("returns an empty list for an item with no tags", async () => {
      const alice = await seedUser();
      const item = await seedItem(alice);

      expect(await getItemTagNames(db, item.id)).toEqual([]);
    });

    it("deletes the underlying tag row once no item references it anymore", async () => {
      const alice = await seedUser();
      const item = await seedItem(alice);
      await setItemTags(db, item.id, ["ctf"]);

      await setItemTags(db, item.id, []);

      expect(await db.select().from(tags)).toHaveLength(0);
    });

    it("keeps a tag row alive if another item still references it", async () => {
      const alice = await seedUser();
      const first = await seedItem(alice);
      const second = await seedItem(alice);
      await setItemTags(db, first.id, ["shared", "only-first"]);
      await setItemTags(db, second.id, ["shared"]);

      await setItemTags(db, first.id, []);

      expect(await listTags(db)).toEqual(["shared"]);
    });
  });

  describe("setFlashcardTags / getFlashcardTagNames", () => {
    it("attaches tags to a flashcard", async () => {
      const alice = await seedUser();
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q", back: "A", source: "https://example.com", tags: ["seed"] });

      await setFlashcardTags(db, card.id, ["ctf", "web"]);

      expect(await getFlashcardTagNames(db, card.id)).toEqual(["ctf", "web"]);
    });

    it("replaces a flashcard's tags on a subsequent call", async () => {
      const alice = await seedUser();
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q", back: "A", source: "https://example.com", tags: ["seed"] });
      await setFlashcardTags(db, card.id, ["ctf", "web"]);

      await setFlashcardTags(db, card.id, ["web"]);

      expect(await getFlashcardTagNames(db, card.id)).toEqual(["web"]);
    });
  });

  describe("pruneUnusedTags cross-table usage (items and flashcards share the tag pool)", () => {
    it("does not delete a tag removed from every item while still attached to a flashcard", async () => {
      const alice = await seedUser();
      const item = await seedItem(alice);
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q", back: "A", source: "https://example.com", tags: ["seed"] });
      await setItemTags(db, item.id, ["shared"]);
      await setFlashcardTags(db, card.id, ["shared"]);

      await setItemTags(db, item.id, []);

      expect(await listTags(db)).toEqual(["shared"]);
      expect(await getFlashcardTagNames(db, card.id)).toEqual(["shared"]);
    });

    it("does not delete a tag removed from every flashcard while still attached to an item", async () => {
      const alice = await seedUser();
      const item = await seedItem(alice);
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q", back: "A", source: "https://example.com", tags: ["seed"] });
      await setItemTags(db, item.id, ["shared"]);
      await setFlashcardTags(db, card.id, ["shared"]);

      await setFlashcardTags(db, card.id, []);

      expect(await listTags(db)).toEqual(["shared"]);
      expect(await getItemTagNames(db, item.id)).toEqual(["shared"]);
    });

    it("deletes a tag once it's removed from both an item and a flashcard", async () => {
      const alice = await seedUser();
      const item = await seedItem(alice);
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q", back: "A", source: "https://example.com", tags: ["seed"] });
      await setItemTags(db, item.id, ["shared"]);
      await setFlashcardTags(db, card.id, ["shared"]);

      await setItemTags(db, item.id, []);
      await setFlashcardTags(db, card.id, []);

      expect(await listTags(db)).toEqual([]);
    });
  });

  describe("mutation logging (ticket 10)", () => {
    it("logs entity/entityId when a new tag is created", async () => {
      const alice = await seedUser();
      const item = await seedItem(alice);
      const { records, restore } = await useTestLogSink();

      try {
        await setItemTags(db, item.id, ["brand-new-tag"]);
      } finally {
        await restore();
      }

      const [tagRow] = await db.select().from(tags).where(eq(tags.name, "brand-new-tag"));
      const record = records.find(
        (r) => r.properties.entity === "tags" && r.properties.entityId === tagRow.id,
      );
      expect(record?.properties).toMatchObject({ entity: "tags", entityId: tagRow.id });
    });

    it("logs entity/entityId when an unused tag is pruned/deleted", async () => {
      const alice = await seedUser();
      const item = await seedItem(alice);
      await setItemTags(db, item.id, ["to-remove"]);
      const [tagRow] = await db.select().from(tags).where(eq(tags.name, "to-remove"));

      const { records, restore } = await useTestLogSink();
      try {
        await setItemTags(db, item.id, []);
      } finally {
        await restore();
      }

      const record = records.find(
        (r) => r.properties.entity === "tags" && r.properties.entityId === tagRow.id,
      );
      expect(record?.properties).toMatchObject({ entity: "tags", entityId: tagRow.id });
    });
  });

  async function seedUser() {
    const [row] = await db
      .insert(users)
      .values({ displayName: "Alice", role: "member" })
      .returning();
    return row;
  }

  async function seedItem(creator: { id: string }, kind: "link" | "page" = "link") {
    const [row] = await db
      .insert(items)
      .values(
        kind === "page"
          ? { kind: "page", title: "A wiki page", content: "Body.", createdBy: creator.id }
          : { kind: "link", url: "https://example.com", title: "Example", createdBy: creator.id },
      )
      .returning();
    return row;
  }
});
