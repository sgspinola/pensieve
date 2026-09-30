import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { items as itemsTable, users } from "@/db/schema";
import { NotFoundError, UnauthorizedError, ValidationError } from "@/services/errors";
import type { SessionUser } from "@/services/auth/session";
import { getItemTagNames, listTags } from "@/services/tags/tags";
import { useTestLogSink } from "@/test/log-sink";
import { ITEMS_PAGE_SIZE } from "@/services/items/pagination";
import {
  LIBRARY_ITEM_KINDS,
  canModifyItem,
  countItems,
  createItem,
  deleteItem,
  getItem,
  isCreatableItemKind,
  isLibraryItemKind,
  listItems,
  updateItem,
} from "@/services/items/items";

describe("items service", () => {
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

  // Shared by the pagination and countItems describe blocks below (ticket
  // 02): seeds `count` plain links for the given creator.
  async function seedLinks(count: number, creator: SessionUser) {
    const deps = { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) };
    const created = [];
    for (let i = 0; i < count; i++) {
      created.push(
        await createItem(
          db,
          { creatorId: creator.id, kind: "link", url: `https://example.com/${i}`, title: `Item ${i}` },
          deps,
        ),
      );
    }
    return created;
  }

  describe("createItem", () => {
    it("prefills title/description from fetched page metadata", async () => {
      const alice = await seedUser("member", "Alice");
      const fetchMetadata = vi.fn().mockResolvedValue({
        title: "Fetched Title",
        description: "Fetched description.",
      });

      const item = await createItem(
        db,
        { creatorId: alice.id, kind: "link", url: "https://example.com" },
        { fetchMetadata },
      );

      expect(item).toMatchObject({
        kind: "link",
        url: "https://example.com",
        title: "Fetched Title",
        description: "Fetched description.",
        createdBy: alice.id,
      });
      expect(fetchMetadata).toHaveBeenCalledWith("https://example.com");
    });

    it("lets the caller override fetched title/description without needing a fetch at all", async () => {
      const alice = await seedUser("member", "Alice");
      const fetchMetadata = vi.fn().mockResolvedValue({
        title: "Should not be used",
        description: "Should not be used",
      });

      const item = await createItem(
        db,
        {
          creatorId: alice.id,
          kind: "tool",
          url: "https://example.com/tool",
          title: "My Own Title",
          description: "My own description.",
        },
        { fetchMetadata },
      );

      expect(item.title).toBe("My Own Title");
      expect(item.description).toBe("My own description.");
      expect(fetchMetadata).not.toHaveBeenCalled();
    });

    it("still creates the item with a null description when metadata fetch fails or returns nothing, as long as a title was given", async () => {
      const alice = await seedUser("member", "Alice");
      const fetchMetadata = vi.fn().mockResolvedValue({ title: null, description: null });

      const item = await createItem(
        db,
        { creatorId: alice.id, kind: "link", url: "https://unreachable.example", title: "Given Title" },
        { fetchMetadata },
      );

      expect(item.title).toBe("Given Title");
      expect(item.description).toBeNull();
    });

    it("rejects creation when metadata fetch fails or returns nothing and no title was given (ticket 03)", async () => {
      const alice = await seedUser("member", "Alice");
      const fetchMetadata = vi.fn().mockResolvedValue({ title: null, description: null });

      await expect(
        createItem(
          db,
          { creatorId: alice.id, kind: "link", url: "https://unreachable.example" },
          { fetchMetadata },
        ),
      ).rejects.toThrow(ValidationError);
    });

    it.each(["link", "tool", "article"] as const)(
      "rejects a %s with an explicit empty-string title, even with a url given (ticket 03)",
      async (kind) => {
        const alice = await seedUser("member", "Alice");

        await expect(
          createItem(
            db,
            { creatorId: alice.id, kind, url: "https://example.com", title: "" },
            { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) },
          ),
        ).rejects.toThrow(ValidationError);
      },
    );

    it("rejects a page with an empty-string title (ticket 03)", async () => {
      const alice = await seedUser("member", "Alice");

      await expect(
        createItem(db, { creatorId: alice.id, kind: "page", title: "", content: "Body." }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects a page with a whitespace-only title (ticket 03)", async () => {
      const alice = await seedUser("member", "Alice");

      await expect(
        createItem(db, { creatorId: alice.id, kind: "page", title: "   ", content: "Body." }),
      ).rejects.toThrow(ValidationError);
    });

    it("saves a shared markdown notes field", async () => {
      const alice = await seedUser("member", "Alice");

      const item = await createItem(
        db,
        {
          creatorId: alice.id,
          kind: "link",
          url: "https://example.com",
          title: "Title",
          description: "Description",
          notes: "# Heading\n\nSome **markdown**.",
        },
        { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) },
      );

      expect(item.notes).toBe("# Heading\n\nSome **markdown**.");
    });

    it("creates a wiki page with a title and markdown content body, no url and no metadata fetch", async () => {
      const alice = await seedUser("member", "Alice");
      const fetchMetadata = vi.fn();

      const item = await createItem(
        db,
        {
          creatorId: alice.id,
          kind: "page",
          title: "My Wiki Page",
          content: "# Heading\n\nSome **markdown** body.",
        },
        { fetchMetadata },
      );

      expect(item).toMatchObject({
        kind: "page",
        url: null,
        title: "My Wiki Page",
        content: "# Heading\n\nSome **markdown** body.",
        createdBy: alice.id,
      });
      expect(fetchMetadata).not.toHaveBeenCalled();
    });

    it("treats link, tool, and article identically — same fields, no special-casing (ticket 02)", async () => {
      const alice = await seedUser("member", "Alice");
      const deps = { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) };

      const link = await createItem(
        db,
        { creatorId: alice.id, kind: "link", url: "https://example.com/link", title: "L", description: "d", notes: "n" },
        deps,
      );
      const tool = await createItem(
        db,
        { creatorId: alice.id, kind: "tool", url: "https://example.com/tool", title: "T", description: "d", notes: "n" },
        deps,
      );
      const article = await createItem(
        db,
        { creatorId: alice.id, kind: "article", url: "https://example.com/article", title: "A", description: "d", notes: "n" },
        deps,
      );

      expect(Object.keys(link).sort()).toEqual(Object.keys(tool).sort());
      expect(Object.keys(link).sort()).toEqual(Object.keys(article).sort());
    });

    it("creates an article exactly like a link — url required, title/description auto-fetched but overridable, no parent/content (ticket 02)", async () => {
      const alice = await seedUser("member", "Alice");
      const fetchMetadata = vi.fn().mockResolvedValue({
        title: "Fetched Article Title",
        description: "Fetched article description.",
      });

      const item = await createItem(
        db,
        { creatorId: alice.id, kind: "article", url: "https://example.com/read-later" },
        { fetchMetadata },
      );

      expect(item).toMatchObject({
        kind: "article",
        url: "https://example.com/read-later",
        title: "Fetched Article Title",
        description: "Fetched article description.",
        content: null,
        parentId: null,
        createdBy: alice.id,
      });
      expect(fetchMetadata).toHaveBeenCalledWith("https://example.com/read-later");
    });

    it("lets the caller override an article's fetched title/description without needing a fetch at all (ticket 02)", async () => {
      const alice = await seedUser("member", "Alice");
      const fetchMetadata = vi.fn().mockResolvedValue({ title: "Should not be used", description: "Should not be used" });

      const item = await createItem(
        db,
        {
          creatorId: alice.id,
          kind: "article",
          url: "https://example.com/read-later",
          title: "My Own Title",
          description: "My own description.",
        },
        { fetchMetadata },
      );

      expect(item.title).toBe("My Own Title");
      expect(item.description).toBe("My own description.");
      expect(fetchMetadata).not.toHaveBeenCalled();
    });
  });

  describe("tags on items", () => {
    it("attaches tags given at creation", async () => {
      const alice = await seedUser("member", "Alice");

      const item = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com",
        title: "T",
        description: "D",
        tags: ["ctf", "web"],
      });

      expect(await getItemTagNames(db, item.id)).toEqual(["ctf", "web"]);
    });

    it("creates an item with no tags when tags is omitted", async () => {
      const alice = await seedUser("member", "Alice");

      const item = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com",
        title: "T",
        description: "D",
      });

      expect(await getItemTagNames(db, item.id)).toEqual([]);
    });

    it("reuses an existing tag row across items instead of creating a duplicate", async () => {
      const alice = await seedUser("member", "Alice");

      await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://a.example.com",
        title: "A",
        description: "D",
        tags: ["Security"],
      });
      const second = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://b.example.com",
        title: "B",
        description: "D",
        tags: ["security"],
      });

      expect(await getItemTagNames(db, second.id)).toEqual(["security"]);
    });

    it("replaces an item's tags on update", async () => {
      const alice = await seedUser("member", "Alice");
      const item = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com",
        title: "T",
        description: "D",
        tags: ["old-tag"],
      });

      await updateItem(db, alice, item.id, { tags: ["new-tag"] });

      expect(await getItemTagNames(db, item.id)).toEqual(["new-tag"]);
    });

    it("leaves existing tags untouched when tags is omitted from an update", async () => {
      const alice = await seedUser("member", "Alice");
      const item = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com",
        title: "Old",
        description: "D",
        tags: ["keep-me"],
      });

      await updateItem(db, alice, item.id, { title: "New" });

      expect(await getItemTagNames(db, item.id)).toEqual(["keep-me"]);
    });

    it("includes each item's tags in the shared list", async () => {
      const alice = await seedUser("member", "Alice");
      const tagged = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/tagged",
        title: "Tagged",
        description: "D",
        tags: ["b-tag", "a-tag"],
      });
      const untagged = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/untagged",
        title: "Untagged",
        description: "D",
      });

      const list = await listItems(db);

      expect(list.find((i) => i.id === tagged.id)).toMatchObject({ tags: ["a-tag", "b-tag"] });
      expect(list.find((i) => i.id === untagged.id)).toMatchObject({ tags: [] });
    });
  });

  describe("listItems", () => {
    it("lists every item regardless of creator, resolving each creator's display name", async () => {
      const alice = await seedUser("member", "Alice");
      const bob = await seedUser("member", "Bob");
      const deps = { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) };

      const first = await createItem(
        db,
        { creatorId: alice.id, kind: "link", url: "https://example.com/a", title: "A" },
        deps,
      );
      const second = await createItem(
        db,
        { creatorId: bob.id, kind: "tool", url: "https://example.com/b", title: "B" },
        deps,
      );

      const list = await listItems(db);

      expect(list).toHaveLength(2);
      expect(list.find((i) => i.id === first.id)).toMatchObject({ createdByName: "Alice" });
      expect(list.find((i) => i.id === second.id)).toMatchObject({ createdByName: "Bob" });
    });

    it("orders items most-recently-created first", async () => {
      const alice = await seedUser("member", "Alice");
      const deps = { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) };

      const first = await createItem(
        db,
        { creatorId: alice.id, kind: "link", url: "https://example.com/1", title: "first" },
        deps,
      );
      const second = await createItem(
        db,
        { creatorId: alice.id, kind: "link", url: "https://example.com/2", title: "second" },
        deps,
      );

      const list = await listItems(db);
      expect(list.map((i) => i.id)).toEqual([second.id, first.id]);
    });

    it("includes wiki pages in the same shared list as links/tools, with creator and timestamps", async () => {
      const alice = await seedUser("member", "Alice");
      const link = await createItem(
        db,
        { creatorId: alice.id, kind: "link", url: "https://example.com", title: "A link" },
        { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) },
      );
      const article = await createItem(db, {
        creatorId: alice.id,
        kind: "page",
        title: "A wiki article",
        content: "Body text.",
      });

      const list = await listItems(db);

      expect(list.map((i) => i.id).sort()).toEqual([link.id, article.id].sort());
      const listedArticle = list.find((i) => i.id === article.id);
      expect(listedArticle).toMatchObject({
        kind: "page",
        title: "A wiki article",
        content: "Body text.",
        createdByName: "Alice",
      });
      expect(listedArticle?.createdAt).toBeInstanceOf(Date);
      expect(listedArticle?.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("listItems search & kind filter (issue 08)", () => {
    it("matches a single search term found only in the title", async () => {
      const alice = await seedUser("member", "Alice");
      const target = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "Exploiting Kubernetes RBAC",
        description: "Unrelated description.",
      });
      const other = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/b",
        title: "Something else entirely",
        description: "Also unrelated.",
      });

      const results = await listItems(db, { query: "kubernetes" });

      expect(results.map((item) => item.id)).toEqual([target.id]);
      expect(results.map((item) => item.id)).not.toContain(other.id);
    });

    it("matches a single search term found only in the description", async () => {
      const alice = await seedUser("member", "Alice");
      const target = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "Some title",
        description: "A deep dive into privilege escalation techniques.",
      });
      const other = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/b",
        title: "Another title",
        description: "Nothing relevant here.",
      });

      const results = await listItems(db, { query: "escalation" });

      expect(results.map((item) => item.id)).toEqual([target.id]);
      expect(results.map((item) => item.id)).not.toContain(other.id);
    });

    it("matches a single search term found only in the notes", async () => {
      const alice = await seedUser("member", "Alice");
      const target = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "Some title",
        description: "Some description",
        notes: "Remember to try the CVE-2024-1234 exploit against staging.",
      });
      const other = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/b",
        title: "Another title",
        description: "Some description",
        notes: "Nothing relevant in this note.",
      });

      const results = await listItems(db, { query: "staging" });

      expect(results.map((item) => item.id)).toEqual([target.id]);
      expect(results.map((item) => item.id)).not.toContain(other.id);
    });

    it("matches a single search term found only in a joined tag name", async () => {
      const alice = await seedUser("member", "Alice");
      const target = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "Some title",
        description: "Some description",
        tags: ["kubernetes", "web"],
      });
      const other = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/b",
        title: "Another title",
        description: "Some description",
        tags: ["web"],
      });

      const results = await listItems(db, { query: "kubernetes" });

      expect(results.map((item) => item.id)).toEqual([target.id]);
      expect(results.map((item) => item.id)).not.toContain(other.id);
    });

    it("narrows results with AND semantics as more terms are added", async () => {
      const alice = await seedUser("member", "Alice");
      // Matches "kubernetes" (title) and "staging" (notes) both.
      const matchesBoth = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "Kubernetes RBAC notes",
        description: "d",
        notes: "Tested against staging.",
      });
      // Matches "kubernetes" only, not "staging".
      const matchesOnlyOne = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/b",
        title: "Kubernetes networking",
        description: "d",
        notes: "Nothing about environments here.",
      });

      const singleTerm = await listItems(db, { query: "kubernetes" });
      expect(singleTerm.map((item) => item.id).sort()).toEqual(
        [matchesBoth.id, matchesOnlyOne.id].sort(),
      );

      const bothTerms = await listItems(db, { query: "kubernetes staging" });
      expect(bothTerms.map((item) => item.id)).toEqual([matchesBoth.id]);
    });

    it("returns an empty result when no item matches the query", async () => {
      const alice = await seedUser("member", "Alice");
      await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "Some title",
        description: "Some description",
      });

      const results = await listItems(db, { query: "nonexistent-term-xyz" });

      expect(results).toEqual([]);
    });

    it("filters the item list by kind", async () => {
      const alice = await seedUser("member", "Alice");
      const link = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "A link",
        description: "d",
      });
      const tool = await createItem(db, {
        creatorId: alice.id,
        kind: "tool",
        url: "https://example.com/b",
        title: "A tool",
        description: "d",
      });
      await createItem(db, {
        creatorId: alice.id,
        kind: "page",
        title: "An article",
        content: "Body.",
      });

      const links = await listItems(db, { kinds: ["link"] });
      expect(links.map((item) => item.id)).toEqual([link.id]);

      const tools = await listItems(db, { kinds: ["tool"] });
      expect(tools.map((item) => item.id)).toEqual([tool.id]);
    });

    it("combines a kind filter with a search query", async () => {
      const alice = await seedUser("member", "Alice");
      const matchingLink = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "Kubernetes RBAC",
        description: "d",
      });
      await createItem(db, {
        creatorId: alice.id,
        kind: "tool",
        url: "https://example.com/b",
        title: "Kubernetes CLI tool",
        description: "d",
      });

      const results = await listItems(db, { query: "kubernetes", kinds: ["link"] });

      expect(results.map((item) => item.id)).toEqual([matchingLink.id]);
    });

    it("treats a literal % in the query as a plain character, not a LIKE wildcard", async () => {
      const alice = await seedUser("member", "Alice");
      // If "%" leaked through as an unescaped LIKE wildcard, a bare "%" query
      // would match every row (its pattern would collapse to "%%%", i.e.
      // "anything") rather than only rows containing a literal "%".
      const target = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "Save 50% today",
        description: "d",
      });
      const other = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/b",
        title: "No special characters here",
        description: "d",
      });

      const results = await listItems(db, { query: "%" });

      expect(results.map((item) => item.id)).toEqual([target.id]);
      expect(results.map((item) => item.id)).not.toContain(other.id);
    });
  });

  describe("listItems tag filter (ticket 01)", () => {
    it("matches an item carrying any one of the given tags", async () => {
      const alice = await seedUser("member", "Alice");
      const webItem = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "A",
        tags: ["web"],
      });
      const ctfItem = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/b",
        title: "B",
        tags: ["ctf"],
      });
      await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/c",
        title: "C",
        tags: ["unrelated"],
      });

      const results = await listItems(db, { tags: ["web", "ctf"] });

      expect(results.map((item) => item.id).sort()).toEqual([ctfItem.id, webItem.id].sort());
    });

    it("uses OR semantics within the tag facet — matching any one selected tag is enough", async () => {
      const alice = await seedUser("member", "Alice");
      const bothTags = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "A",
        tags: ["web", "ctf"],
      });
      const onlyWeb = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/b",
        title: "B",
        tags: ["web"],
      });

      const results = await listItems(db, { tags: ["web", "ctf"] });

      expect(results.map((item) => item.id).sort()).toEqual([bothTags.id, onlyWeb.id].sort());
    });

    it("excludes items with no tag in the given list", async () => {
      const alice = await seedUser("member", "Alice");
      await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "A",
        tags: ["unrelated"],
      });
      await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/b",
        title: "B",
      });

      const results = await listItems(db, { tags: ["web"] });

      expect(results).toEqual([]);
    });

    it("ANDs the tags condition with an existing kind filter", async () => {
      const alice = await seedUser("member", "Alice");
      const matchingLink = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "A",
        tags: ["web"],
      });
      await createItem(db, {
        creatorId: alice.id,
        kind: "tool",
        url: "https://example.com/b",
        title: "B",
        tags: ["web"],
      });

      const results = await listItems(db, { tags: ["web"], kinds: ["link"] });

      expect(results.map((item) => item.id)).toEqual([matchingLink.id]);
    });

    it("ANDs the tags condition with an existing search query", async () => {
      const alice = await seedUser("member", "Alice");
      const matching = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "Kubernetes RBAC",
        tags: ["web"],
      });
      await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/b",
        title: "Kubernetes networking",
        tags: ["ctf"],
      });
      await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/c",
        title: "Unrelated title",
        tags: ["web"],
      });

      const results = await listItems(db, { query: "kubernetes", tags: ["web"] });

      expect(results.map((item) => item.id)).toEqual([matching.id]);
    });

    it("matches a tag filter case-insensitively, mirroring tag-name normalization at write time", async () => {
      const alice = await seedUser("member", "Alice");
      const item = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "A",
        tags: ["Security"],
      });

      const results = await listItems(db, { tags: ["security"] });

      expect(results.map((i) => i.id)).toEqual([item.id]);
    });

    it("leaves kind/query-only behavior unchanged when tags is omitted or empty", async () => {
      const alice = await seedUser("member", "Alice");
      const item = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "A",
        tags: ["web"],
      });

      const withoutTags = await listItems(db, {});
      expect(withoutTags.map((i) => i.id)).toEqual([item.id]);

      const withEmptyTags = await listItems(db, { tags: [] });
      expect(withEmptyTags.map((i) => i.id)).toEqual([item.id]);
    });
  });

  describe("listItems kinds filter (ticket 03)", () => {
    it("matches an item whose kind is any one of the given kinds", async () => {
      const alice = await seedUser("member", "Alice");
      const link = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "A link",
        description: "d",
      });
      const tool = await createItem(db, {
        creatorId: alice.id,
        kind: "tool",
        url: "https://example.com/b",
        title: "A tool",
        description: "d",
      });
      await createItem(db, {
        creatorId: alice.id,
        kind: "page",
        title: "An article",
        content: "Body.",
      });

      const results = await listItems(db, { kinds: ["link", "tool"] });

      expect(results.map((item) => item.id).sort()).toEqual([link.id, tool.id].sort());
    });

    it("uses OR semantics within the kinds facet — matching any one selected kind is enough", async () => {
      const alice = await seedUser("member", "Alice");
      const link = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "A link",
        description: "d",
      });
      const tool = await createItem(db, {
        creatorId: alice.id,
        kind: "tool",
        url: "https://example.com/b",
        title: "A tool",
        description: "d",
      });
      const page = await createItem(db, {
        creatorId: alice.id,
        kind: "page",
        title: "A wiki page",
        content: "Body.",
      });

      const results = await listItems(db, { kinds: ["link", "tool", "page"] });

      expect(results.map((item) => item.id).sort()).toEqual(
        [link.id, tool.id, page.id].sort(),
      );
    });

    it("excludes items whose kind is not in the given list", async () => {
      const alice = await seedUser("member", "Alice");
      await createItem(db, {
        creatorId: alice.id,
        kind: "page",
        title: "An article",
        content: "Body.",
      });

      const results = await listItems(db, { kinds: ["link", "tool"] });

      expect(results).toEqual([]);
    });

    it("ANDs the kinds condition with an existing search query", async () => {
      const alice = await seedUser("member", "Alice");
      const matchingLink = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "Kubernetes RBAC",
        description: "d",
      });
      await createItem(db, {
        creatorId: alice.id,
        kind: "page",
        title: "Kubernetes article",
        content: "Body.",
      });

      const results = await listItems(db, { query: "kubernetes", kinds: ["link", "tool"] });

      expect(results.map((item) => item.id)).toEqual([matchingLink.id]);
    });

    it("ANDs the kinds condition with an existing tags filter", async () => {
      const alice = await seedUser("member", "Alice");
      const matchingLink = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "A",
        tags: ["web"],
      });
      await createItem(db, {
        creatorId: alice.id,
        kind: "page",
        title: "An article",
        content: "Body.",
        tags: ["web"],
      });

      const results = await listItems(db, { tags: ["web"], kinds: ["link", "tool"] });

      expect(results.map((item) => item.id)).toEqual([matchingLink.id]);
    });

    it("leaves the unfiltered behavior unchanged when kinds is omitted or empty", async () => {
      const alice = await seedUser("member", "Alice");
      const link = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/a",
        title: "A link",
        description: "d",
      });
      const article = await createItem(db, {
        creatorId: alice.id,
        kind: "page",
        title: "An article",
        content: "Body.",
      });

      const withoutKinds = await listItems(db, {});
      expect(withoutKinds.map((i) => i.id).sort()).toEqual([link.id, article.id].sort());

      const withEmptyKinds = await listItems(db, { kinds: [] });
      expect(withEmptyKinds.map((i) => i.id).sort()).toEqual([link.id, article.id].sort());
    });
  });

  describe("listItems pagination (ticket 02)", () => {
    it("returns the complete unpaginated array when no limit/cursor is given (backward compatibility)", async () => {
      const alice = await seedUser("member", "Alice");
      await seedLinks(5, alice);

      const list = await listItems(db);

      expect(Array.isArray(list)).toBe(true);
      expect(list).toHaveLength(5);
    });

    // Regression coverage (ticket 02): WikiLayout, WikiArticlePage, and
    // exportItemsFile all call listItems with no limit/cursor and need
    // every matching item — a page-size default silently leaking into the
    // unpaginated path here would truncate the wiki tree/export to
    // ITEMS_PAGE_SIZE without any of those call sites changing at all. This
    // seeds more than ITEMS_PAGE_SIZE items to prove that can't happen.
    it("returns every item with no truncation even when there are more than ITEMS_PAGE_SIZE of them", async () => {
      const alice = await seedUser("member", "Alice");
      await seedLinks(ITEMS_PAGE_SIZE + 5, alice);

      const list = await listItems(db);

      expect(Array.isArray(list)).toBe(true);
      expect(list).toHaveLength(ITEMS_PAGE_SIZE + 5);
    });

    it("returns the complete unpaginated array when other filters are given but no limit/cursor", async () => {
      const alice = await seedUser("member", "Alice");
      await seedLinks(3, alice);

      const list = await listItems(db, { kinds: ["link"] });

      expect(Array.isArray(list)).toBe(true);
      expect(list).toHaveLength(3);
    });

    it("returns only `limit` items plus a non-null nextCursor when more remain", async () => {
      const alice = await seedUser("member", "Alice");
      await seedLinks(5, alice);

      const page = await listItems(db, { limit: 3 });

      expect(page.items).toHaveLength(3);
      expect(page.nextCursor).not.toBeNull();
    });

    it("returns nextCursor: null on the exact last page (no phantom next page)", async () => {
      const alice = await seedUser("member", "Alice");
      await seedLinks(3, alice);

      const page = await listItems(db, { limit: 3 });

      expect(page.items).toHaveLength(3);
      expect(page.nextCursor).toBeNull();
    });

    it("advances the cursor to fetch the rest with no skips or duplicates, newest first", async () => {
      const alice = await seedUser("member", "Alice");
      const created = await db
        .insert(itemsTable)
        .values(
          Array.from({ length: 7 }, (_, i) => ({
            kind: "link" as const,
            url: `https://example.com/${i}`,
            title: `Item ${i}`,
            createdBy: alice.id,
            createdAt: new Date(Date.UTC(2024, 0, 1, 0, 0, i)),
          })),
        )
        .returning();

      const page1 = await listItems(db, { limit: 3 });
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await listItems(db, { limit: 3, cursor: page1.nextCursor! });
      expect(page2.nextCursor).not.toBeNull();
      const page3 = await listItems(db, { limit: 3, cursor: page2.nextCursor! });
      expect(page3.nextCursor).toBeNull();

      const seenIds = [...page1.items, ...page2.items, ...page3.items].map((i) => i.id);
      expect(seenIds).toEqual([...created].reverse().map((i) => i.id));
      expect(new Set(seenIds).size).toBe(7);
    });

    it("uses id as a tie-breaker so rows sharing the same createdAt still paginate without skips or duplicates", async () => {
      const alice = await seedUser("member", "Alice");
      const sameInstant = new Date("2024-01-01T00:00:00.000Z");
      const [rowA, rowB, rowC] = await db
        .insert(itemsTable)
        .values([
          { kind: "link" as const, url: "https://example.com/a", title: "A", createdBy: alice.id, createdAt: sameInstant },
          { kind: "link" as const, url: "https://example.com/b", title: "B", createdBy: alice.id, createdAt: sameInstant },
          { kind: "link" as const, url: "https://example.com/c", title: "C", createdBy: alice.id, createdAt: sameInstant },
        ])
        .returning();
      const expectedOrder = [rowA, rowB, rowC].map((r) => r.id).sort().reverse();

      const page1 = await listItems(db, { limit: 2 });
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await listItems(db, { limit: 2, cursor: page1.nextCursor! });

      const seenIds = [...page1.items, ...page2.items].map((i) => i.id);
      expect(seenIds).toEqual(expectedOrder);
    });

    it("keeps paging through only the filtered set (kinds/query/tags) across multiple cursor pages", async () => {
      const alice = await seedUser("member", "Alice");
      const deps = { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) };
      const tools = [];
      for (let i = 0; i < 5; i++) {
        tools.push(
          await createItem(
            db,
            { creatorId: alice.id, kind: "tool", url: `https://example.com/tool-${i}`, title: `Tool ${i}` },
            deps,
          ),
        );
        await createItem(
          db,
          { creatorId: alice.id, kind: "link", url: `https://example.com/link-${i}`, title: `Link ${i}` },
          deps,
        );
      }

      const page1 = await listItems(db, { kinds: ["tool"], limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await listItems(db, { kinds: ["tool"], limit: 2, cursor: page1.nextCursor! });
      expect(page2.nextCursor).not.toBeNull();
      const page3 = await listItems(db, { kinds: ["tool"], limit: 2, cursor: page2.nextCursor! });
      expect(page3.nextCursor).toBeNull();
      expect(page3.items).toHaveLength(1);

      const seenIds = [...page1.items, ...page2.items, ...page3.items].map((i) => i.id);
      expect(seenIds.sort()).toEqual(tools.map((t) => t.id).sort());
    });

    it("rejects a malformed cursor with ValidationError", async () => {
      await expect(listItems(db, { limit: 10, cursor: "not-a-real-cursor" })).rejects.toThrow(ValidationError);
    });
  });

  describe("countItems (ticket 02)", () => {
    it("counts every item when no filters are given", async () => {
      const alice = await seedUser("member", "Alice");
      const deps = { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) };
      await createItem(db, { creatorId: alice.id, kind: "link", url: "https://example.com/a", title: "A" }, deps);
      await createItem(db, { creatorId: alice.id, kind: "tool", url: "https://example.com/b", title: "B" }, deps);

      expect(await countItems(db)).toBe(2);
    });

    it("counts only items matching the kinds filter", async () => {
      const alice = await seedUser("member", "Alice");
      const deps = { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) };
      await createItem(db, { creatorId: alice.id, kind: "link", url: "https://example.com/a", title: "A" }, deps);
      await createItem(db, { creatorId: alice.id, kind: "tool", url: "https://example.com/b", title: "B" }, deps);
      await createItem(db, { creatorId: alice.id, kind: "tool", url: "https://example.com/c", title: "C" }, deps);

      expect(await countItems(db, { kinds: ["tool"] })).toBe(2);
    });

    it("counts only items matching the search query", async () => {
      const alice = await seedUser("member", "Alice");
      const deps = { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) };
      await createItem(db, { creatorId: alice.id, kind: "link", url: "https://example.com/a", title: "Kubernetes" }, deps);
      await createItem(db, { creatorId: alice.id, kind: "link", url: "https://example.com/b", title: "Docker" }, deps);

      expect(await countItems(db, { query: "kubernetes" })).toBe(1);
    });

    it("counts only items matching the tags filter (OR semantics)", async () => {
      const alice = await seedUser("member", "Alice");
      const deps = { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) };
      await createItem(db, { creatorId: alice.id, kind: "link", url: "https://example.com/a", title: "A", tags: ["networking"] }, deps);
      await createItem(db, { creatorId: alice.id, kind: "link", url: "https://example.com/b", title: "B", tags: ["cryptography"] }, deps);
      await createItem(db, { creatorId: alice.id, kind: "link", url: "https://example.com/c", title: "C", tags: ["unrelated"] }, deps);

      expect(await countItems(db, { tags: ["networking", "cryptography"] })).toBe(2);
    });

    it("composes kinds/query/tags filters with AND, matching listItems", async () => {
      const alice = await seedUser("member", "Alice");
      const deps = { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) };
      await createItem(
        db,
        { creatorId: alice.id, kind: "tool", url: "https://example.com/a", title: "Kubernetes tool", tags: ["devops"] },
        deps,
      );
      await createItem(
        db,
        { creatorId: alice.id, kind: "link", url: "https://example.com/b", title: "Kubernetes link", tags: ["devops"] },
        deps,
      );
      await createItem(
        db,
        { creatorId: alice.id, kind: "tool", url: "https://example.com/c", title: "Docker tool", tags: ["devops"] },
        deps,
      );

      expect(await countItems(db, { kinds: ["tool"], query: "kubernetes", tags: ["devops"] })).toBe(1);
    });

    it("returns 0 for a workspace with no matching items", async () => {
      expect(await countItems(db)).toBe(0);
    });

    it("stays constant across pagination — matches the total item count regardless of page size", async () => {
      const alice = await seedUser("member", "Alice");
      await seedLinks(7, alice);

      const total = await countItems(db);
      const page = await listItems(db, { limit: 3 });

      expect(total).toBe(7);
      expect(page.items).toHaveLength(3);
    });
  });

  describe("isCreatableItemKind", () => {
    it("accepts link, tool, article, and page, rejects everything else", () => {
      expect(isCreatableItemKind("link")).toBe(true);
      expect(isCreatableItemKind("tool")).toBe(true);
      expect(isCreatableItemKind("article")).toBe(true);
      expect(isCreatableItemKind("page")).toBe(true);
      expect(isCreatableItemKind("bogus")).toBe(false);
      expect(isCreatableItemKind(undefined)).toBe(false);
    });
  });

  describe("LIBRARY_ITEM_KINDS / isLibraryItemKind", () => {
    it("includes every creatable kind except the wiki page kind", () => {
      expect(LIBRARY_ITEM_KINDS.sort()).toEqual(["article", "link", "tool"]);
    });

    it("accepts link, tool, and article, rejects page and anything else", () => {
      expect(isLibraryItemKind("link")).toBe(true);
      expect(isLibraryItemKind("tool")).toBe(true);
      expect(isLibraryItemKind("article")).toBe(true);
      expect(isLibraryItemKind("page")).toBe(false);
      expect(isLibraryItemKind("bogus")).toBe(false);
      expect(isLibraryItemKind(undefined)).toBe(false);
    });
  });

  describe("canModifyItem (permission check)", () => {
    it("allows the admin to modify any item", () => {
      const admin: SessionUser = { id: "admin-id", displayName: "Admin", role: "admin" };
      expect(canModifyItem(admin, { createdBy: "someone-else" })).toBe(true);
    });

    it("allows a member to modify their own item", () => {
      const member: SessionUser = { id: "member-id", displayName: "Member", role: "member" };
      expect(canModifyItem(member, { createdBy: "member-id" })).toBe(true);
    });

    it("rejects a member modifying another member's item", () => {
      const member: SessionUser = { id: "member-id", displayName: "Member", role: "member" };
      expect(canModifyItem(member, { createdBy: "someone-else" })).toBe(false);
    });
  });

  describe("updateItem", () => {
    it("lets a member update their own item", async () => {
      const alice = await seedUser("member", "Alice");
      const item = await createItem(
        db,
        { creatorId: alice.id, kind: "link", url: "https://example.com", title: "Old" },
        { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) },
      );

      const updated = await updateItem(db, alice, item.id, { title: "New" });

      expect(updated.title).toBe("New");
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(item.updatedAt.getTime());
    });

    it("rejects blanking a title to empty/whitespace on update (ticket 03)", async () => {
      const alice = await seedUser("member", "Alice");
      const item = await createItem(
        db,
        { creatorId: alice.id, kind: "link", url: "https://example.com", title: "Old" },
        { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) },
      );

      await expect(updateItem(db, alice, item.id, { title: "" })).rejects.toThrow(ValidationError);
      await expect(updateItem(db, alice, item.id, { title: "   " })).rejects.toThrow(ValidationError);

      const stillOriginal = await getItem(db, item.id);
      expect(stillOriginal.title).toBe("Old");
    });

    it("rejects a member updating another member's item", async () => {
      const alice = await seedUser("member", "Alice");
      const bob = await seedUser("member", "Bob");
      const item = await createItem(
        db,
        { creatorId: alice.id, kind: "link", url: "https://example.com", title: "Old" },
        { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) },
      );

      await expect(updateItem(db, bob, item.id, { title: "Hijacked" })).rejects.toThrow(
        UnauthorizedError,
      );

      const stillOriginal = await getItem(db, item.id);
      expect(stillOriginal.title).toBe("Old");
    });

    it("lets the admin update any item regardless of who created it", async () => {
      const alice = await seedUser("member", "Alice");
      const admin = await seedUser("admin", "Admin");
      const item = await createItem(
        db,
        { creatorId: alice.id, kind: "link", url: "https://example.com", title: "Old" },
        { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) },
      );

      const updated = await updateItem(db, admin, item.id, { title: "Fixed by admin" });
      expect(updated.title).toBe("Fixed by admin");
    });

    it("throws NotFoundError for a nonexistent item", async () => {
      const admin = await seedUser("admin", "Admin");
      await expect(
        updateItem(db, admin, "00000000-0000-0000-0000-000000000000", { title: "x" }),
      ).rejects.toThrow(NotFoundError);
    });

    it("overwrites a page's content in place, keeping only the latest version", async () => {
      const alice = await seedUser("member", "Alice");
      const article = await createItem(db, {
        creatorId: alice.id,
        kind: "page",
        title: "Draft",
        content: "Version one.",
      });

      const updated = await updateItem(db, alice, article.id, { content: "Version two." });
      expect(updated.content).toBe("Version two.");

      const reloaded = await getItem(db, article.id);
      expect(reloaded.content).toBe("Version two.");
    });

    it("lets any workspace member (not just the creator or an admin) edit a page's fields — ticket 02 opens this up", async () => {
      const alice = await seedUser("member", "Alice");
      const bob = await seedUser("member", "Bob");
      const article = await createItem(db, {
        creatorId: alice.id,
        kind: "page",
        title: "Draft",
        content: "Original content.",
      });

      const updated = await updateItem(db, bob, article.id, {
        title: "Edited by Bob",
        content: "Edited content.",
        notes: "Some notes.",
        tags: ["wiki"],
      });

      expect(updated.title).toBe("Edited by Bob");
      expect(updated.content).toBe("Edited content.");
      expect(updated.notes).toBe("Some notes.");
      expect(await getItemTagNames(db, article.id)).toEqual(["wiki"]);
    });

    describe("parentId (ticket 02)", () => {
      it("accepts a parentId on create that references an existing page", async () => {
        const alice = await seedUser("member", "Alice");
        const parent = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Parent",
          content: "Parent body.",
        });

        const child = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Child",
          content: "Child body.",
          parentId: parent.id,
        });

        expect(child.parentId).toBe(parent.id);
      });

      it("defaults parentId to null when omitted on create", async () => {
        const alice = await seedUser("member", "Alice");
        const article = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Top level",
          content: "Body.",
        });

        expect(article.parentId).toBeNull();
      });

      it("rejects create with parentId referencing a non-page item", async () => {
        const alice = await seedUser("member", "Alice");
        const link = await createItem(
          db,
          { creatorId: alice.id, kind: "link", url: "https://example.com", title: "L" },
          { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) },
        );

        await expect(
          createItem(db, {
            creatorId: alice.id,
            kind: "page",
            title: "Child",
            content: "Body.",
            parentId: link.id,
          }),
        ).rejects.toThrow(ValidationError);
      });

      it("rejects create with parentId referencing a nonexistent item", async () => {
        const alice = await seedUser("member", "Alice");

        await expect(
          createItem(db, {
            creatorId: alice.id,
            kind: "page",
            title: "Child",
            content: "Body.",
            parentId: "00000000-0000-0000-0000-000000000000",
          }),
        ).rejects.toThrow(ValidationError);
      });

      it("rejects setting parentId on create for a link or tool", async () => {
        const alice = await seedUser("member", "Alice");
        const parentArticle = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Parent",
          content: "Body.",
        });

        await expect(
          createItem(
            db,
            {
              creatorId: alice.id,
              kind: "link",
              url: "https://example.com",
              title: "L",
              parentId: parentArticle.id,
            },
            { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) },
          ),
        ).rejects.toThrow(ValidationError);
      });

      it("rejects setting parentId on create for an article (ticket 02)", async () => {
        const alice = await seedUser("member", "Alice");
        const parentPage = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Parent",
          content: "Body.",
        });

        await expect(
          createItem(
            db,
            {
              creatorId: alice.id,
              kind: "article",
              url: "https://example.com",
              title: "A",
              parentId: parentPage.id,
            },
            { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) },
          ),
        ).rejects.toThrow(ValidationError);
      });

      it("lets updateItem set parentId to an existing page", async () => {
        const alice = await seedUser("member", "Alice");
        const parent = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Parent",
          content: "Body.",
        });
        const child = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Child",
          content: "Body.",
        });

        const updated = await updateItem(db, alice, child.id, { parentId: parent.id });

        expect(updated.parentId).toBe(parent.id);
      });

      it("lets updateItem clear parentId back to null", async () => {
        const alice = await seedUser("member", "Alice");
        const parent = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Parent",
          content: "Body.",
        });
        const child = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Child",
          content: "Body.",
          parentId: parent.id,
        });

        const updated = await updateItem(db, alice, child.id, { parentId: null });

        expect(updated.parentId).toBeNull();
      });

      it("rejects updateItem setting parentId to a non-page item", async () => {
        const alice = await seedUser("member", "Alice");
        const article = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Article",
          content: "Body.",
        });
        const tool = await createItem(
          db,
          { creatorId: alice.id, kind: "tool", url: "https://example.com/tool", title: "T" },
          { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) },
        );

        await expect(
          updateItem(db, alice, article.id, { parentId: tool.id }),
        ).rejects.toThrow(ValidationError);
      });

      it("rejects updateItem setting parentId to a nonexistent item", async () => {
        const alice = await seedUser("member", "Alice");
        const article = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Article",
          content: "Body.",
        });

        await expect(
          updateItem(db, alice, article.id, {
            parentId: "00000000-0000-0000-0000-000000000000",
          }),
        ).rejects.toThrow(ValidationError);
      });

      it("rejects updateItem setting parentId on a link or tool", async () => {
        const alice = await seedUser("member", "Alice");
        const parentArticle = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Parent",
          content: "Body.",
        });
        const link = await createItem(
          db,
          { creatorId: alice.id, kind: "link", url: "https://example.com", title: "L" },
          { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) },
        );

        await expect(
          updateItem(db, alice, link.id, { parentId: parentArticle.id }),
        ).rejects.toThrow(ValidationError);
      });

      it("rejects a direct cycle — a page reparented to its own child", async () => {
        const alice = await seedUser("member", "Alice");
        const parent = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Parent",
          content: "Body.",
        });
        const child = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Child",
          content: "Body.",
          parentId: parent.id,
        });

        await expect(
          updateItem(db, alice, parent.id, { parentId: child.id }),
        ).rejects.toThrow(ValidationError);
      });

      it("rejects a deeper cycle — a page reparented to its grandchild", async () => {
        const alice = await seedUser("member", "Alice");
        const grandparent = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Grandparent",
          content: "Body.",
        });
        const parent = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Parent",
          content: "Body.",
          parentId: grandparent.id,
        });
        const child = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Child",
          content: "Body.",
          parentId: parent.id,
        });

        await expect(
          updateItem(db, alice, grandparent.id, { parentId: child.id }),
        ).rejects.toThrow(ValidationError);

        const stillOriginal = await getItem(db, grandparent.id);
        expect(stillOriginal.parentId).toBeNull();
      });

      it("allows a legitimate reparent that does not create a cycle", async () => {
        const alice = await seedUser("member", "Alice");
        const branchA = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Branch A",
          content: "Body.",
        });
        const branchB = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Branch B",
          content: "Body.",
        });
        const leaf = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Leaf",
          content: "Body.",
          parentId: branchA.id,
        });

        const updated = await updateItem(db, alice, leaf.id, { parentId: branchB.id });

        expect(updated.parentId).toBe(branchB.id);
      });

      it("does not re-check for a cycle when parentId is unchanged", async () => {
        const alice = await seedUser("member", "Alice");
        const parent = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Parent",
          content: "Body.",
        });
        const child = await createItem(db, {
          creatorId: alice.id,
          kind: "page",
          title: "Child",
          content: "Body.",
          parentId: parent.id,
        });

        const updated = await updateItem(db, alice, child.id, {
          parentId: parent.id,
          title: "Child renamed",
        });

        expect(updated.parentId).toBe(parent.id);
        expect(updated.title).toBe("Child renamed");
      });
    });
  });

  describe("deleteItem", () => {
    it("lets a member delete their own item", async () => {
      const alice = await seedUser("member", "Alice");
      const item = await createItem(
        db,
        { creatorId: alice.id, kind: "link", url: "https://example.com", title: "Old" },
        { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) },
      );

      await deleteItem(db, alice, item.id);

      await expect(getItem(db, item.id)).rejects.toThrow(NotFoundError);
    });

    it("rejects a member deleting another member's item", async () => {
      const alice = await seedUser("member", "Alice");
      const bob = await seedUser("member", "Bob");
      const item = await createItem(
        db,
        { creatorId: alice.id, kind: "link", url: "https://example.com", title: "Old" },
        { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) },
      );

      await expect(deleteItem(db, bob, item.id)).rejects.toThrow(UnauthorizedError);
      await expect(getItem(db, item.id)).resolves.toMatchObject({ id: item.id });
    });

    it("lets the admin delete any item regardless of who created it", async () => {
      const alice = await seedUser("member", "Alice");
      const admin = await seedUser("admin", "Admin");
      const item = await createItem(
        db,
        { creatorId: alice.id, kind: "link", url: "https://example.com", title: "Old" },
        { fetchMetadata: vi.fn().mockResolvedValue({ title: null, description: null }) },
      );

      await deleteItem(db, admin, item.id);
      await expect(getItem(db, item.id)).rejects.toThrow(NotFoundError);
    });

    it("throws NotFoundError for a nonexistent item", async () => {
      const admin = await seedUser("admin", "Admin");
      await expect(
        deleteItem(db, admin, "00000000-0000-0000-0000-000000000000"),
      ).rejects.toThrow(NotFoundError);
    });

    it("lets the admin delete a page regardless of who created it", async () => {
      const alice = await seedUser("member", "Alice");
      const admin = await seedUser("admin", "Admin");
      const article = await createItem(db, {
        creatorId: alice.id,
        kind: "page",
        title: "Draft",
        content: "Some content.",
      });

      await deleteItem(db, admin, article.id);
      await expect(getItem(db, article.id)).rejects.toThrow(NotFoundError);
    });

    it("rejects a member deleting another member's page", async () => {
      const alice = await seedUser("member", "Alice");
      const bob = await seedUser("member", "Bob");
      const article = await createItem(db, {
        creatorId: alice.id,
        kind: "page",
        title: "Draft",
        content: "Some content.",
      });

      await expect(deleteItem(db, bob, article.id)).rejects.toThrow(UnauthorizedError);
      await expect(getItem(db, article.id)).resolves.toMatchObject({ id: article.id });
    });

    it("deletes a tag left unused once its only item is deleted", async () => {
      const alice = await seedUser("member", "Alice");
      const item = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com",
        title: "Old",
        description: "D",
        tags: ["solo-tag"],
      });

      await deleteItem(db, alice, item.id);

      expect(await listTags(db)).toEqual([]);
    });

    it("keeps a tag another item still uses after one referencing item is deleted", async () => {
      const alice = await seedUser("member", "Alice");
      const first = await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/1",
        title: "First",
        description: "D",
        tags: ["shared"],
      });
      await createItem(db, {
        creatorId: alice.id,
        kind: "link",
        url: "https://example.com/2",
        title: "Second",
        description: "D",
        tags: ["shared"],
      });

      await deleteItem(db, alice, first.id);

      expect(await listTags(db)).toEqual(["shared"]);
    });
  });

  describe("mutation logging (ticket 09)", () => {
    it("logs entity/kind/entityId on createItem success", async () => {
      const alice = await seedUser("member", "Alice");
      const { records, restore } = await useTestLogSink();

      let item;
      try {
        item = await createItem(db, { creatorId: alice.id, kind: "page", title: "A Page" });
      } finally {
        await restore();
      }

      const record = records.find((r) => r.properties.entity === "items");
      expect(record?.properties).toMatchObject({ entity: "items", kind: "page", entityId: item.id });
    });

    it("still logs entity (with no entityId, since no row was ever created) when createItem throws before inserting", async () => {
      const { records, restore } = await useTestLogSink();

      try {
        // Missing creatorId/kind fails the DB insert's NOT NULL constraints
        // before any row exists.
        await expect(
          createItem(db, { creatorId: "not-a-real-user-id", kind: "page", title: "Orphan" }),
        ).rejects.toThrow();
      } finally {
        await restore();
      }

      const record = records.find((r) => r.properties.entity === "items");
      expect(record?.properties).toMatchObject({ entity: "items", kind: "page" });
      expect(record?.properties.entityId).toBeUndefined();
    });

    it("logs entity/kind/entityId/changedFields on updateItem success, naming only the fields that actually differ", async () => {
      const alice = await seedUser("member", "Alice");
      const item = await createItem(db, {
        creatorId: alice.id,
        kind: "page",
        title: "Original Title",
        notes: "unchanged notes",
      });

      const { records, restore } = await useTestLogSink();
      try {
        await updateItem(db, alice, item.id, { title: "New Title", notes: "unchanged notes" });
      } finally {
        await restore();
      }

      const record = records.find((r) => r.properties.entity === "items");
      expect(record?.properties).toMatchObject({
        entity: "items",
        kind: "page",
        entityId: item.id,
        changedFields: ["title"],
      });
      // No old/new values anywhere in the log line, only field names.
      expect(JSON.stringify(record?.properties)).not.toContain("New Title");
      expect(JSON.stringify(record?.properties)).not.toContain("Original Title");
    });

    it("logs entity/kind/entityId on deleteItem success", async () => {
      const alice = await seedUser("member", "Alice");
      const item = await createItem(db, { creatorId: alice.id, kind: "page", title: "To delete" });

      const { records, restore } = await useTestLogSink();
      try {
        await deleteItem(db, alice, item.id);
      } finally {
        await restore();
      }

      const record = records.find((r) => r.properties.entity === "items");
      expect(record?.properties).toMatchObject({ entity: "items", kind: "page", entityId: item.id });
    });

    it("still logs entity/kind/entityId when updateItem throws", async () => {
      const alice = await seedUser("member", "Alice");
      const item = await createItem(db, { creatorId: alice.id, kind: "page", title: "Original" });

      const { records, restore } = await useTestLogSink();
      try {
        await expect(updateItem(db, alice, item.id, { title: "" })).rejects.toThrow(ValidationError);
      } finally {
        await restore();
      }

      const record = records.find((r) => r.properties.entity === "items");
      expect(record?.properties).toMatchObject({ entity: "items", kind: "page", entityId: item.id });
    });

    it("still logs entity/kind/entityId when deleteItem throws", async () => {
      const alice = await seedUser("member", "Alice");
      const bob = await seedUser("member", "Bob");
      const item = await createItem(db, { creatorId: alice.id, kind: "link", url: "https://example.com", title: "T" });

      const { records, restore } = await useTestLogSink();
      try {
        await expect(deleteItem(db, bob, item.id)).rejects.toThrow(UnauthorizedError);
      } finally {
        await restore();
      }

      const record = records.find((r) => r.properties.entity === "items");
      expect(record?.properties).toMatchObject({ entity: "items", kind: "link", entityId: item.id });
    });

    it("omits kind (but keeps entity/entityId) when updateItem fails because the item doesn't exist", async () => {
      const alice = await seedUser("member", "Alice");
      const missingId = "00000000-0000-0000-0000-000000000000";

      const { records, restore } = await useTestLogSink();
      try {
        await expect(updateItem(db, alice, missingId, { title: "New" })).rejects.toThrow(NotFoundError);
      } finally {
        await restore();
      }

      const record = records.find((r) => r.properties.entity === "items");
      expect(record?.properties).toMatchObject({ entity: "items", entityId: missingId });
      expect(record?.properties.kind).toBeUndefined();
    });
  });
});
