import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { flashcards as flashcardsTable, users } from "@/db/schema";
import { sha256Hex } from "@/lib/crypto";
import { NotFoundError, UnauthorizedError, ValidationError } from "@/services/errors";
import type { SessionUser } from "@/services/auth/session";
import { getFlashcardTagNames, listTags } from "@/services/tags/tags";
import { useTestLogSink } from "@/test/log-sink";
import {
  canDeleteFlashcard,
  countFlashcards,
  createFlashcard,
  deleteFlashcard,
  getFlashcard,
  listFlashcards,
  updateFlashcard,
} from "@/services/flashcards/flashcards";

describe("flashcards service", () => {
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

  async function seedUser(role: "admin" | "member", displayName: string): Promise<SessionUser> {
    const [row] = await db.insert(users).values({ displayName, role }).returning();
    return { id: row.id, displayName: row.displayName, role: row.role };
  }

  describe("createFlashcard", () => {
    it("rejects creating a flashcard with zero tags (ticket 04: mandatory tags)", async () => {
      const alice = await seedUser("member", "Alice");

      await expect(
        createFlashcard(db, {
          creatorId: alice.id,
          front: "What is TCP?",
          back: "A connection-oriented transport protocol.",
          source: "https://example.com",
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects creating a flashcard with an explicit empty tags array (ticket 04)", async () => {
      const alice = await seedUser("member", "Alice");

      await expect(
        createFlashcard(db, {
          creatorId: alice.id,
          front: "What is TCP?",
          back: "A connection-oriented transport protocol.",
          source: "https://example.com",
          tags: [],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects creating a flashcard whose tags are all blank/whitespace-only (ticket 04)", async () => {
      const alice = await seedUser("member", "Alice");

      await expect(
        createFlashcard(db, {
          creatorId: alice.id,
          front: "What is TCP?",
          back: "A connection-oriented transport protocol.",
          source: "https://example.com",
          tags: ["", "   "],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("computes and stores frontHash as the SHA-256 hex digest of the trimmed front (ticket 04)", async () => {
      const alice = await seedUser("member", "Alice");

      const card = await createFlashcard(db, {
        creatorId: alice.id,
        front: "  What is TCP?  ",
        back: "A connection-oriented transport protocol.",
        source: "https://example.com",
        tags: ["networking"],
      });

      expect(card.frontHash).toBe(sha256Hex("What is TCP?"));
    });

    it("rejects a duplicate trimmed front with a friendly ValidationError, not the raw unique-constraint error (ticket 04)", async () => {
      const alice = await seedUser("member", "Alice");
      await createFlashcard(db, {
        creatorId: alice.id,
        front: "What is TCP?",
        back: "A connection-oriented transport protocol.",
        source: "https://example.com",
        tags: ["networking"],
      });

      await expect(
        createFlashcard(db, {
          creatorId: alice.id,
          front: "  What is TCP?  ",
          back: "A different answer.",
          source: "https://example.com/2",
          tags: ["networking"],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("stores back as purely answer text, never appending a source citation to it (ticket 04)", async () => {
      const alice = await seedUser("member", "Alice");

      const card = await createFlashcard(db, {
        creatorId: alice.id,
        front: "What is TCP?",
        back: "A connection-oriented transport protocol.",
        source: "https://example.com",
        tags: ["networking"],
      });

      expect(card.back).toBe("A connection-oriented transport protocol.");
      expect(card.back).not.toContain("Source");
    });

    it("creates a flashcard with tags", async () => {
      const alice = await seedUser("member", "Alice");

      const card = await createFlashcard(db, {
        creatorId: alice.id,
        front: "What is a subnet mask?",
        back: "A bitmask that divides an IP address into network and host parts.",
        source: "https://example.com",
        tags: ["networking", "ipv4"],
      });

      expect(await getFlashcardTagNames(db, card.id)).toEqual(["ipv4", "networking"]);
    });
  });

  describe("getFlashcard", () => {
    it("returns the flashcard by id", async () => {
      const alice = await seedUser("member", "Alice");
      const created = await createFlashcard(db, { creatorId: alice.id, front: "Q", back: "A", source: "https://example.com", tags: ["general"] });

      const fetched = await getFlashcard(db, created.id);

      expect(fetched).toMatchObject({ front: "Q", back: "A", source: "https://example.com" });
    });

    it("throws NotFoundError for a missing id", async () => {
      await expect(getFlashcard(db, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(NotFoundError);
    });
  });

  describe("updateFlashcard", () => {
    it("allows a non-creator actor to update front/back/tags (open-edit)", async () => {
      const alice = await seedUser("member", "Alice");
      const bob = await seedUser("member", "Bob");
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q1", back: "A1", source: "https://example.com", tags: ["initial"] });

      const updated = await updateFlashcard(db, bob, card.id, {
        front: "Q1 revised",
        back: "A1 revised",
        source: "https://example.com",
        tags: ["revised"],
      });

      expect(updated).toMatchObject({ front: "Q1 revised", back: "A1 revised", source: "https://example.com" });
      expect(await getFlashcardTagNames(db, card.id)).toEqual(["revised"]);
    });

    it("recomputes frontHash when front changes, and rejects a collision with another card's front (ticket 04)", async () => {
      const alice = await seedUser("member", "Alice");
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q1", back: "A1", source: "https://example.com", tags: ["general"] });
      const other = await createFlashcard(db, { creatorId: alice.id, front: "Q2", back: "A2", source: "https://example.com", tags: ["general"] });

      const updated = await updateFlashcard(db, alice, card.id, { front: "Q1 revised" });
      expect(updated.frontHash).toBe(sha256Hex("Q1 revised"));

      await expect(updateFlashcard(db, alice, other.id, { front: "Q1 revised" })).rejects.toThrow(
        ValidationError,
      );
    });

    it("leaves omitted fields unchanged", async () => {
      const alice = await seedUser("member", "Alice");
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q1", back: "A1", source: "https://example.com", tags: ["general"] });

      const updated = await updateFlashcard(db, alice, card.id, { front: "Q1 revised" });

      expect(updated).toMatchObject({ front: "Q1 revised", back: "A1", source: "https://example.com" });
    });

    it("leaves tags unchanged when tags is omitted", async () => {
      const alice = await seedUser("member", "Alice");
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q", back: "A", source: "https://example.com", tags: ["kept"] });

      await updateFlashcard(db, alice, card.id, { front: "Q revised" });

      expect(await getFlashcardTagNames(db, card.id)).toEqual(["kept"]);
    });

    it("rejects updating a flashcard down to zero tags via an explicit empty array (ticket 04)", async () => {
      const alice = await seedUser("member", "Alice");
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q", back: "A", source: "https://example.com", tags: ["kept"] });

      await expect(updateFlashcard(db, alice, card.id, { tags: [] })).rejects.toThrow(ValidationError);
      expect(await getFlashcardTagNames(db, card.id)).toEqual(["kept"]);
    });

    it("rejects updating a flashcard's tags down to only blank/whitespace-only names (ticket 04)", async () => {
      const alice = await seedUser("member", "Alice");
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q", back: "A", source: "https://example.com", tags: ["kept"] });

      await expect(updateFlashcard(db, alice, card.id, { tags: ["", "   "] })).rejects.toThrow(ValidationError);
      expect(await getFlashcardTagNames(db, card.id)).toEqual(["kept"]);
    });

    it("rejects an empty-tags update to a nonexistent flashcard with NotFoundError, not ValidationError", async () => {
      const alice = await seedUser("member", "Alice");

      await expect(updateFlashcard(db, alice, "00000000-0000-0000-0000-000000000000", { tags: [] })).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe("deleteFlashcard", () => {
    it("allows the creator to delete their own flashcard", async () => {
      const alice = await seedUser("member", "Alice");
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q", back: "A", source: "https://example.com", tags: ["general"] });

      await deleteFlashcard(db, alice, card.id);

      await expect(getFlashcard(db, card.id)).rejects.toThrow(NotFoundError);
    });

    it("rejects a non-creator member with UnauthorizedError", async () => {
      const alice = await seedUser("member", "Alice");
      const bob = await seedUser("member", "Bob");
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q", back: "A", source: "https://example.com", tags: ["general"] });

      await expect(deleteFlashcard(db, bob, card.id)).rejects.toThrow(UnauthorizedError);
    });

    it("allows a non-creator admin to delete another member's flashcard (admin override)", async () => {
      const alice = await seedUser("member", "Alice");
      const admin = await seedUser("admin", "Admin");
      const card = await createFlashcard(db, { creatorId: alice.id, front: "Q", back: "A", source: "https://example.com", tags: ["general"] });

      await deleteFlashcard(db, admin, card.id);

      await expect(getFlashcard(db, card.id)).rejects.toThrow(NotFoundError);
    });

    it("prunes a tag left with zero references after deleting its last flashcard", async () => {
      const alice = await seedUser("member", "Alice");
      const card = await createFlashcard(db, {
        creatorId: alice.id,
        front: "Q",
        back: "A",
        source: "https://example.com",
        tags: ["orphan-candidate"],
      });

      await deleteFlashcard(db, alice, card.id);

      expect(await listTags(db)).not.toContain("orphan-candidate");
    });

    it("leaves a tag in place when another flashcard still references it", async () => {
      const alice = await seedUser("member", "Alice");
      const card1 = await createFlashcard(db, {
        creatorId: alice.id,
        front: "Q1",
        back: "A1",
        source: "https://example.com",
        tags: ["shared"],
      });
      await createFlashcard(db, {
        creatorId: alice.id,
        front: "Q2",
        back: "A2",
        source: "https://example.com",
        tags: ["shared"],
      });

      await deleteFlashcard(db, alice, card1.id);

      expect(await listTags(db)).toContain("shared");
    });
  });

  describe("canDeleteFlashcard", () => {
    it("returns true for the creator and for any admin, false for a non-creator, non-admin member", () => {
      const alice: SessionUser = { id: "alice-id", displayName: "Alice", role: "member" };
      const admin: SessionUser = { id: "admin-id", displayName: "Admin", role: "admin" };
      const bob: SessionUser = { id: "bob-id", displayName: "Bob", role: "member" };
      const flashcard = { createdBy: "alice-id" };

      expect(canDeleteFlashcard(alice, flashcard)).toBe(true);
      expect(canDeleteFlashcard(admin, flashcard)).toBe(true);
      expect(canDeleteFlashcard(bob, flashcard)).toBe(false);
    });
  });

  describe("listFlashcards", () => {
    it("lists every flashcard in the workspace with createdByName resolved", async () => {
      const alice = await seedUser("member", "Alice");
      const bob = await seedUser("member", "Bob");
      await createFlashcard(db, { creatorId: alice.id, front: "Q1", back: "A1", source: "https://example.com", tags: ["general"] });
      await createFlashcard(db, { creatorId: bob.id, front: "Q2", back: "A2", source: "https://example.com", tags: ["general"] });

      const page = await listFlashcards(db);

      expect(page.flashcards).toHaveLength(2);
      expect(page.flashcards.map((c) => c.createdByName).sort()).toEqual(["Alice", "Bob"]);
    });

    it("filters by tags using OR semantics", async () => {
      const alice = await seedUser("member", "Alice");
      const networking = await createFlashcard(db, {
        creatorId: alice.id,
        front: "Q1",
        back: "A1",
        source: "https://example.com",
        tags: ["networking"],
      });
      const crypto = await createFlashcard(db, {
        creatorId: alice.id,
        front: "Q2",
        back: "A2",
        source: "https://example.com",
        tags: ["cryptography"],
      });
      await createFlashcard(db, { creatorId: alice.id, front: "Q3", back: "A3", source: "https://example.com", tags: ["unrelated"] });

      const matched = await listFlashcards(db, { tags: ["networking", "cryptography"] });

      expect(matched.flashcards.map((c) => c.id).sort()).toEqual([networking.id, crypto.id].sort());
    });

    it("returns every flashcard when no tags filter is given", async () => {
      const alice = await seedUser("member", "Alice");
      await createFlashcard(db, { creatorId: alice.id, front: "Q1", back: "A1", source: "https://example.com", tags: ["general"] });
      await createFlashcard(db, { creatorId: alice.id, front: "Q2", back: "A2", source: "https://example.com", tags: ["general"] });

      expect((await listFlashcards(db)).flashcards).toHaveLength(2);
    });

    it("returns nextCursor: null and every card when no limit is given (unbounded, current behavior)", async () => {
      const alice = await seedUser("member", "Alice");
      for (let i = 0; i < 5; i++) {
        await createFlashcard(db, { creatorId: alice.id, front: `Q${i}`, back: `A${i}`, source: "https://example.com", tags: ["general"] });
      }

      const page = await listFlashcards(db);

      expect(page.flashcards).toHaveLength(5);
      expect(page.nextCursor).toBeNull();
    });

    it("returns only `limit` cards plus a non-null nextCursor when more remain", async () => {
      const alice = await seedUser("member", "Alice");
      for (let i = 0; i < 5; i++) {
        await createFlashcard(db, { creatorId: alice.id, front: `Q${i}`, back: `A${i}`, source: "https://example.com", tags: ["general"] });
      }

      const page = await listFlashcards(db, { limit: 3 });

      expect(page.flashcards).toHaveLength(3);
      expect(page.nextCursor).not.toBeNull();
    });

    it("returns nextCursor: null on the exact last page (no phantom next page)", async () => {
      const alice = await seedUser("member", "Alice");
      for (let i = 0; i < 3; i++) {
        await createFlashcard(db, { creatorId: alice.id, front: `Q${i}`, back: `A${i}`, source: "https://example.com", tags: ["general"] });
      }

      const page = await listFlashcards(db, { limit: 3 });

      expect(page.flashcards).toHaveLength(3);
      expect(page.nextCursor).toBeNull();
    });

    it("advances the cursor to fetch the rest with no skips or duplicates, newest first", async () => {
      const alice = await seedUser("member", "Alice");
      // Explicit, distinct-by-a-full-second createdAt values (rather than
      // back-to-back createFlashcard() calls, which can land in the same
      // millisecond on a fast test run) so creation order is unambiguous —
      // same-millisecond ties are covered separately below.
      const created = await db
        .insert(flashcardsTable)
        .values(
          Array.from({ length: 7 }, (_, i) => ({
            front: `Q${i}`,
            back: `A${i}`,
            frontHash: sha256Hex(`Q${i}`),
            source: "https://example.com",
            createdBy: alice.id,
            createdAt: new Date(Date.UTC(2024, 0, 1, 0, 0, i)),
          })),
        )
        .returning();

      const page1 = await listFlashcards(db, { limit: 3 });
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await listFlashcards(db, { limit: 3, cursor: page1.nextCursor! });
      expect(page2.nextCursor).not.toBeNull();
      const page3 = await listFlashcards(db, { limit: 3, cursor: page2.nextCursor! });
      expect(page3.nextCursor).toBeNull();

      const seenIds = [...page1.flashcards, ...page2.flashcards, ...page3.flashcards].map((c) => c.id);
      // Newest (last inserted) first — see listFlashcards's docstring.
      expect(seenIds).toEqual([...created].reverse().map((c) => c.id));
      expect(new Set(seenIds).size).toBe(7);
    });

    it("does not skip or duplicate older cards when a new card is inserted between page fetches", async () => {
      const alice = await seedUser("member", "Alice");
      // Explicit, distinct createdAt values for `first`/`second` (rather
      // than two back-to-back createFlashcard() calls, which can land in
      // the same millisecond under load) so which one page 1 returns is
      // deterministic — the tie-break itself is covered separately above.
      const [first, second] = await db
        .insert(flashcardsTable)
        .values([
          { front: "Q1", back: "A1", frontHash: sha256Hex("Q1"), source: "https://example.com", createdBy: alice.id, createdAt: new Date("2024-01-01T00:00:00.000Z") },
          { front: "Q2", back: "A2", frontHash: sha256Hex("Q2"), source: "https://example.com", createdBy: alice.id, createdAt: new Date("2024-01-01T00:00:01.000Z") },
        ])
        .returning();

      const page1 = await listFlashcards(db, { limit: 1 });
      // Newest first: `second` (the later timestamp), not `first`.
      expect(page1.flashcards.map((c) => c.id)).toEqual([second.id]);

      // Simulates a card created mid-session, after page 1 was fetched. It's
      // newer than everything else, so it lands ahead of the cursor — in
      // the page-1 window a fresh fetch would show, not one still to come —
      // and must not disturb the boundary for `first`, which is still owed.
      await createFlashcard(db, { creatorId: alice.id, front: "Mid-session", back: "A", source: "https://example.com", tags: ["general"] });

      const page2 = await listFlashcards(db, { limit: 10, cursor: page1.nextCursor! });

      expect(page2.flashcards.map((c) => c.id)).toEqual([first.id]);
    });

    it("uses id as a tie-breaker so rows sharing the same createdAt still paginate without skips or duplicates", async () => {
      const alice = await seedUser("member", "Alice");
      const sameInstant = new Date("2024-01-01T00:00:00.000Z");
      const [rowA, rowB, rowC] = await db
        .insert(flashcardsTable)
        .values([
          { front: "Q1", back: "A1", frontHash: sha256Hex("Q1"), source: "https://example.com", createdBy: alice.id, createdAt: sameInstant },
          { front: "Q2", back: "A2", frontHash: sha256Hex("Q2"), source: "https://example.com", createdBy: alice.id, createdAt: sameInstant },
          { front: "Q3", back: "A3", frontHash: sha256Hex("Q3"), source: "https://example.com", createdBy: alice.id, createdAt: sameInstant },
        ])
        .returning();
      // Descending id tie-break (matching listFlashcards's newest-first order).
      const expectedOrder = [rowA, rowB, rowC].map((r) => r.id).sort().reverse();

      const page1 = await listFlashcards(db, { limit: 2 });
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await listFlashcards(db, { limit: 2, cursor: page1.nextCursor! });

      const seenIds = [...page1.flashcards, ...page2.flashcards].map((c) => c.id);
      expect(seenIds).toEqual(expectedOrder);
    });

    it("ticket 05: keeps paging through only the tag-filtered set across multiple cursor pages, skipping untagged cards", async () => {
      const alice = await seedUser("member", "Alice");
      // 5 tagged cards (the filtered set under test) interleaved with 3
      // untagged cards, so a filter that leaked through to the cursor
      // predicate incorrectly (or vice versa) would show up as either an
      // untagged card appearing in a page, or the tagged set failing to
      // paginate to completion.
      const tagged = [];
      for (let i = 0; i < 5; i++) {
        tagged.push(
          await createFlashcard(db, { creatorId: alice.id, front: `Tagged ${i}`, back: "A", source: "https://example.com", tags: ["study"] }),
        );
        // Inserted directly (bypassing createFlashcard, which now requires
        // at least one tag — ticket 04) to simulate an untagged row still
        // present in the table, and confirm the tag filter still skips it.
        await db.insert(flashcardsTable).values({
          front: `Untagged ${i}`,
          back: "A",
          frontHash: sha256Hex(`Untagged ${i}`),
          source: "https://example.com",
          createdBy: alice.id,
        });
      }

      const page1 = await listFlashcards(db, { tags: ["study"], limit: 2 });
      expect(page1.flashcards).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await listFlashcards(db, { tags: ["study"], limit: 2, cursor: page1.nextCursor! });
      expect(page2.nextCursor).not.toBeNull();
      const page3 = await listFlashcards(db, { tags: ["study"], limit: 2, cursor: page2.nextCursor! });
      expect(page3.nextCursor).toBeNull();
      expect(page3.flashcards).toHaveLength(1);

      const seenIds = [...page1.flashcards, ...page2.flashcards, ...page3.flashcards].map((c) => c.id);
      expect(seenIds.sort()).toEqual(tagged.map((c) => c.id).sort());
    });

    it("rejects a malformed cursor with ValidationError", async () => {
      await expect(listFlashcards(db, { limit: 10, cursor: "not-a-real-cursor" })).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe("countFlashcards", () => {
    it("returns 0 for an empty workspace", async () => {
      expect(await countFlashcards(db)).toBe(0);
    });

    it("counts every flashcard in the workspace when no tags filter is given", async () => {
      const alice = await seedUser("member", "Alice");
      await createFlashcard(db, {
        creatorId: alice.id,
        front: "Q1",
        back: "A1",
        source: "https://example.com",
        tags: ["misc"],
      });
      await createFlashcard(db, {
        creatorId: alice.id,
        front: "Q2",
        back: "A2",
        source: "https://example.com",
        tags: ["misc"],
      });

      expect(await countFlashcards(db)).toBe(2);
    });

    it("counts only flashcards matching an OR tags filter, same semantics as listFlashcards", async () => {
      const alice = await seedUser("member", "Alice");
      await createFlashcard(db, {
        creatorId: alice.id,
        front: "Q1",
        back: "A1",
        source: "https://example.com",
        tags: ["networking"],
      });
      await createFlashcard(db, {
        creatorId: alice.id,
        front: "Q2",
        back: "A2",
        source: "https://example.com",
        tags: ["cryptography"],
      });
      await createFlashcard(db, { creatorId: alice.id, front: "Q3", back: "A3", source: "https://example.com", tags: ["unrelated"] });

      expect(await countFlashcards(db, { tags: ["networking", "cryptography"] })).toBe(2);
    });

    it("is not affected by limit/cursor pagination — it reflects the true total regardless of page size (ticket 01)", async () => {
      const alice = await seedUser("member", "Alice");
      for (let i = 0; i < 5; i++) {
        await createFlashcard(db, {
          creatorId: alice.id,
          front: `Q${i}`,
          back: `A${i}`,
          source: "https://example.com",
          tags: ["misc"],
        });
      }

      const page = await listFlashcards(db, { limit: 2 });
      expect(page.flashcards).toHaveLength(2);

      expect(await countFlashcards(db)).toBe(5);
    });
  });

  describe("mutation logging (ticket 09)", () => {
    it("logs entity/entityId on createFlashcard success", async () => {
      const alice = await seedUser("member", "Alice");
      const { records, restore } = await useTestLogSink();

      let flashcard;
      try {
        flashcard = await createFlashcard(db, {
          creatorId: alice.id,
          front: "Front text",
          back: "Back text",
          source: "https://example.com",
          tags: ["misc"],
        });
      } finally {
        await restore();
      }

      const record = records.find((r) => r.properties.entity === "flashcards");
      expect(record?.properties).toMatchObject({ entity: "flashcards", entityId: flashcard.id });
    });

    it("still logs entity (with no entityId, since no row was ever created) when createFlashcard throws before inserting", async () => {
      const alice = await seedUser("member", "Alice");
      const { records, restore } = await useTestLogSink();

      try {
        // No tags fails validation before anything is written.
        await expect(
          createFlashcard(db, { creatorId: alice.id, front: "Q", back: "A", source: "https://example.com", tags: [] }),
        ).rejects.toThrow(ValidationError);
      } finally {
        await restore();
      }

      const record = records.find((r) => r.properties.entity === "flashcards");
      expect(record?.properties.entity).toBe("flashcards");
      expect(record?.properties.entityId).toBeUndefined();
    });

    it("logs entity/entityId/changedFields on updateFlashcard success, naming only the fields that actually differ", async () => {
      const alice = await seedUser("member", "Alice");
      const flashcard = await createFlashcard(db, {
        creatorId: alice.id,
        front: "Original front",
        back: "Same back",
        source: "https://example.com",
        tags: ["misc"],
      });

      const { records, restore } = await useTestLogSink();
      try {
        await updateFlashcard(db, alice, flashcard.id, { front: "New front", back: "Same back" });
      } finally {
        await restore();
      }

      const record = records.find((r) => r.properties.entity === "flashcards");
      expect(record?.properties).toMatchObject({
        entity: "flashcards",
        entityId: flashcard.id,
        changedFields: ["front"],
      });
      // No old/new values anywhere in the log line, only field names.
      expect(JSON.stringify(record?.properties)).not.toContain("New front");
      expect(JSON.stringify(record?.properties)).not.toContain("Original front");
    });

    it("logs entity/entityId on deleteFlashcard success", async () => {
      const alice = await seedUser("member", "Alice");
      const flashcard = await createFlashcard(db, {
        creatorId: alice.id,
        front: "To delete",
        back: "Back",
        source: "https://example.com",
        tags: ["misc"],
      });

      const { records, restore } = await useTestLogSink();
      try {
        await deleteFlashcard(db, alice, flashcard.id);
      } finally {
        await restore();
      }

      const record = records.find((r) => r.properties.entity === "flashcards");
      expect(record?.properties).toMatchObject({ entity: "flashcards", entityId: flashcard.id });
    });

    it("still logs entity/entityId when updateFlashcard throws", async () => {
      const alice = await seedUser("member", "Alice");
      const flashcard = await createFlashcard(db, {
        creatorId: alice.id,
        front: "Original front",
        back: "Back",
        source: "https://example.com",
        tags: ["misc"],
      });

      const { records, restore } = await useTestLogSink();
      try {
        await expect(updateFlashcard(db, alice, flashcard.id, { tags: [] })).rejects.toThrow(ValidationError);
      } finally {
        await restore();
      }

      const record = records.find((r) => r.properties.entity === "flashcards");
      expect(record?.properties).toMatchObject({ entity: "flashcards", entityId: flashcard.id });
    });

    it("still logs entity/entityId when deleteFlashcard throws", async () => {
      const alice = await seedUser("member", "Alice");
      const bob = await seedUser("member", "Bob");
      const flashcard = await createFlashcard(db, {
        creatorId: alice.id,
        front: "Not Bob's to delete",
        back: "Back",
        source: "https://example.com",
        tags: ["misc"],
      });

      const { records, restore } = await useTestLogSink();
      try {
        await expect(deleteFlashcard(db, bob, flashcard.id)).rejects.toThrow(UnauthorizedError);
      } finally {
        await restore();
      }

      const record = records.find((r) => r.properties.entity === "flashcards");
      expect(record?.properties).toMatchObject({ entity: "flashcards", entityId: flashcard.id });
    });
  });
});
