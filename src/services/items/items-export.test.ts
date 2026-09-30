import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { users } from "@/db/schema";
import { splitFrontmatterEntries } from "@/lib/frontmatter-file";
import { createItem } from "@/services/items/items";
import { exportItemsFile } from "@/services/items/items-export";
import { ITEMS_PAGE_SIZE } from "@/services/items/pagination";

describe("exportItemsFile", () => {
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

  it("produces an empty file for a workspace with no items of that kind", async () => {
    const file = await exportItemsFile(db, "link");
    expect(file.trim()).toBe("");
  });

  it("round-trips a single link's title/url/tags/description frontmatter and notes body through gray-matter", async () => {
    const creatorId = await seedUser();
    await createItem(
      db,
      {
        creatorId,
        kind: "link",
        url: "https://example.com/rbac",
        title: "Kubernetes RBAC",
        description: "A deep dive into RBAC.",
        notes: "Worth re-reading.",
        tags: ["kubernetes", "rbac"],
      },
      { fetchMetadata: async () => ({ title: null, description: null }) },
    );

    const file = await exportItemsFile(db, "link");
    const { data, content } = matter(file);

    expect(data).toEqual({
      title: "Kubernetes RBAC",
      url: "https://example.com/rbac",
      tags: ["kubernetes", "rbac"],
      description: "A deep dive into RBAC.",
    });
    expect(content.trim()).toBe("Worth re-reading.");
  });

  it("only includes items of the requested kind", async () => {
    const creatorId = await seedUser();
    const deps = { fetchMetadata: async () => ({ title: null, description: null }) };
    await createItem(db, { creatorId, kind: "link", url: "https://example.com/l", title: "A link" }, deps);
    await createItem(db, { creatorId, kind: "tool", url: "https://example.com/t", title: "A tool" }, deps);
    await createItem(db, { creatorId, kind: "article", url: "https://example.com/a", title: "An article" }, deps);

    const file = await exportItemsFile(db, "tool");
    const { data } = matter(file);
    expect(data.title).toBe("A tool");
    expect(splitFrontmatterEntries(file)).toHaveLength(1);
  });

  it("omits description from frontmatter when null rather than emitting a null field", async () => {
    const creatorId = await seedUser();
    await createItem(
      db,
      { creatorId, kind: "link", url: "https://example.com", title: "No description" },
      { fetchMetadata: async () => ({ title: null, description: null }) },
    );

    const file = await exportItemsFile(db, "link");
    const { data } = matter(file);
    expect("description" in data).toBe(false);
  });

  it("produces a multi-entry file that ticket 01's splitter partitions back into the same number of chunks", async () => {
    const creatorId = await seedUser();
    const deps = { fetchMetadata: async () => ({ title: null, description: null }) };
    for (let i = 0; i < 4; i++) {
      await createItem(
        db,
        {
          creatorId,
          kind: "article",
          url: `https://example.com/${i}`,
          title: `Article ${i}`,
          notes: `Notes ${i}.\n\nSecond line.`,
        },
        deps,
      );
    }

    const file = await exportItemsFile(db, "article");
    const chunks = splitFrontmatterEntries(file);
    expect(chunks).toHaveLength(4);
  });

  // Regression coverage (ticket 02, items library infinite scroll):
  // exportItemsFile calls listItems with no limit/cursor and needs every
  // matching item — a page-size default silently leaking into the
  // unpaginated path would truncate the export to ITEMS_PAGE_SIZE without
  // this call site changing at all.
  it("exports every matching item with no truncation even when there are more than ITEMS_PAGE_SIZE of them", async () => {
    const creatorId = await seedUser();
    const deps = { fetchMetadata: async () => ({ title: null, description: null }) };
    const total = ITEMS_PAGE_SIZE + 5;
    for (let i = 0; i < total; i++) {
      await createItem(
        db,
        { creatorId, kind: "link", url: `https://example.com/${i}`, title: `Item ${i}` },
        deps,
      );
    }

    const file = await exportItemsFile(db, "link");
    expect(splitFrontmatterEntries(file)).toHaveLength(total);
  });
});
