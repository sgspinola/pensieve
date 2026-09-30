import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { users } from "@/db/schema";
import { UnauthorizedError } from "@/services/errors";
import type { SessionUser } from "@/services/auth/session";
import { createItem, getItem } from "@/services/items/items";
import { useTestLogSink } from "@/test/log-sink";
import { listTags, setItemTags } from "@/services/tags/tags";
import { buildArticleTree, deleteArticleWithChildren, getAncestorChain, wouldCreateCycle } from "./wiki";

interface TestArticle {
  id: string;
  parentId: string | null;
  title: string;
}

describe("buildArticleTree", () => {
  it("nests a multi-level tree and orders siblings alphabetically by title", () => {
    // Siblings are deliberately out of alphabetical order in the input array.
    const articles: TestArticle[] = [
      { id: "root", parentId: null, title: "Root" },
      { id: "child-z", parentId: "root", title: "Zebra" },
      { id: "child-a", parentId: "root", title: "Apple" },
      { id: "child-m", parentId: "root", title: "Mango" },
      { id: "grandchild-b", parentId: "child-a", title: "Banana" },
      { id: "grandchild-a", parentId: "child-a", title: "Avocado" },
      { id: "great-grandchild", parentId: "grandchild-a", title: "Deepest" },
    ];

    const tree = buildArticleTree(articles);

    expect(tree).toHaveLength(1);
    const root = tree[0];
    expect(root.id).toBe("root");
    expect(root.children.map((c) => c.title)).toEqual(["Apple", "Mango", "Zebra"]);

    const appleNode = root.children.find((c) => c.id === "child-a")!;
    expect(appleNode.children.map((c) => c.title)).toEqual(["Avocado", "Banana"]);

    const avocadoNode = appleNode.children.find((c) => c.id === "grandchild-a")!;
    expect(avocadoNode.children).toHaveLength(1);
    expect(avocadoNode.children[0].title).toBe("Deepest");
    expect(avocadoNode.children[0].children).toEqual([]);

    // Leaves with no children get an empty children array.
    const mangoNode = root.children.find((c) => c.id === "child-m")!;
    expect(mangoNode.children).toEqual([]);
  });

  it("produces a forest when multiple articles have no parent", () => {
    const articles: TestArticle[] = [
      { id: "root-b", parentId: null, title: "Second Root" },
      { id: "root-a", parentId: null, title: "First Root" },
      { id: "child", parentId: "root-a", title: "Child" },
    ];

    const tree = buildArticleTree(articles);

    expect(tree).toHaveLength(2);
    // Roots are also siblings, so alphabetical ordering applies to them too.
    expect(tree.map((n) => n.title)).toEqual(["First Root", "Second Root"]);

    const firstRoot = tree.find((n) => n.id === "root-a")!;
    expect(firstRoot.children.map((c) => c.title)).toEqual(["Child"]);

    const secondRoot = tree.find((n) => n.id === "root-b")!;
    expect(secondRoot.children).toEqual([]);
  });

  it("preserves extra fields on the original article alongside children", () => {
    const articles = [{ id: "a", parentId: null, title: "A", extra: 42 }];
    const tree = buildArticleTree(articles);
    expect(tree[0].extra).toBe(42);
    expect(tree[0].children).toEqual([]);
  });
});

describe("getAncestorChain", () => {
  it("returns the ordered root-to-self list for a deeply nested article", () => {
    const articles: TestArticle[] = [
      { id: "root", parentId: null, title: "Root" },
      { id: "mid", parentId: "root", title: "Mid" },
      { id: "leaf", parentId: "mid", title: "Leaf" },
      { id: "deepest", parentId: "leaf", title: "Deepest" },
    ];

    const chain = getAncestorChain(articles, "deepest");

    expect(chain.map((a) => a.id)).toEqual(["root", "mid", "leaf", "deepest"]);
  });

  it("returns a single-element chain for a root article", () => {
    const articles: TestArticle[] = [{ id: "root", parentId: null, title: "Root" }];
    const chain = getAncestorChain(articles, "root");
    expect(chain.map((a) => a.id)).toEqual(["root"]);
  });
});

describe("wouldCreateCycle", () => {
  it("detects a direct self-parent attempt", () => {
    const articles: TestArticle[] = [{ id: "A", parentId: null, title: "A" }];
    expect(wouldCreateCycle(articles, "A", "A")).toBe(true);
  });

  it("detects a deeper attempt to reparent an article under one of its own descendants", () => {
    const articles: TestArticle[] = [
      { id: "A", parentId: null, title: "A" },
      { id: "B", parentId: "A", title: "B" },
      { id: "C", parentId: "B", title: "C" },
    ];
    expect(wouldCreateCycle(articles, "A", "C")).toBe(true);
  });

  it("returns false for a non-cyclic reparent", () => {
    const articles: TestArticle[] = [
      { id: "A", parentId: null, title: "A" },
      { id: "B", parentId: "A", title: "B" },
      { id: "C", parentId: null, title: "C" },
    ];
    expect(wouldCreateCycle(articles, "C", "B")).toBe(false);
  });
});

describe("deleteArticleWithChildren", () => {
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

  async function seedArticle(
    creatorId: string,
    title: string,
    parentId: string | null = null,
  ) {
    return createItem(db, { creatorId, kind: "page", title, content: "Body.", parentId });
  }

  describe("promote path (cascade: false)", () => {
    it("promotes a top-level article's children to top-level when it is deleted", async () => {
      const alice = await seedUser("member", "Alice");
      const root = await seedArticle(alice.id, "Root");
      const childA = await seedArticle(alice.id, "Child A", root.id);
      const childB = await seedArticle(alice.id, "Child B", root.id);

      await deleteArticleWithChildren(db, alice, root.id, { cascade: false });

      const reloadedA = await getItem(db, childA.id);
      const reloadedB = await getItem(db, childB.id);
      expect(reloadedA.parentId).toBeNull();
      expect(reloadedB.parentId).toBeNull();
    });

    it("re-parents a nested article's children to its own parent (not top-level) when it is deleted", async () => {
      const alice = await seedUser("member", "Alice");
      const grandparent = await seedArticle(alice.id, "Grandparent");
      const parent = await seedArticle(alice.id, "Parent", grandparent.id);
      const child = await seedArticle(alice.id, "Child", parent.id);

      await deleteArticleWithChildren(db, alice, parent.id, { cascade: false });

      const reloadedChild = await getItem(db, child.id);
      expect(reloadedChild.parentId).toBe(grandparent.id);
    });

    it("deletes the article itself", async () => {
      const alice = await seedUser("member", "Alice");
      const article = await seedArticle(alice.id, "Solo");

      await deleteArticleWithChildren(db, alice, article.id, { cascade: false });

      await expect(getItem(db, article.id)).rejects.toThrow();
    });

    it("lets the creator promote-delete their own article", async () => {
      const alice = await seedUser("member", "Alice");
      const article = await seedArticle(alice.id, "Mine");

      await expect(
        deleteArticleWithChildren(db, alice, article.id, { cascade: false }),
      ).resolves.toBeUndefined();
    });

    it("lets an admin (non-creator) promote-delete another member's article", async () => {
      const alice = await seedUser("member", "Alice");
      const admin = await seedUser("admin", "Admin");
      const article = await seedArticle(alice.id, "Alice's article");

      await expect(
        deleteArticleWithChildren(db, admin, article.id, { cascade: false }),
      ).resolves.toBeUndefined();
    });

    it("rejects a non-creator, non-admin member with UnauthorizedError", async () => {
      const alice = await seedUser("member", "Alice");
      const bob = await seedUser("member", "Bob");
      const article = await seedArticle(alice.id, "Alice's article");

      await expect(
        deleteArticleWithChildren(db, bob, article.id, { cascade: false }),
      ).rejects.toThrow(UnauthorizedError);

      await expect(getItem(db, article.id)).resolves.toMatchObject({ id: article.id });
    });

    it("deletes a tag left unused after promote-deleting its only article", async () => {
      const alice = await seedUser("member", "Alice");
      const article = await seedArticle(alice.id, "Solo");
      await setItemTags(db, article.id, ["solo-tag"]);

      await deleteArticleWithChildren(db, alice, article.id, { cascade: false });

      expect(await listTags(db)).toEqual([]);
    });

    it("keeps a tag another article still uses after promote-deleting one of them", async () => {
      const alice = await seedUser("member", "Alice");
      const root = await seedArticle(alice.id, "Root");
      const other = await seedArticle(alice.id, "Other");
      await setItemTags(db, root.id, ["shared"]);
      await setItemTags(db, other.id, ["shared"]);

      await deleteArticleWithChildren(db, alice, root.id, { cascade: false });

      expect(await listTags(db)).toEqual(["shared"]);
    });

    it("logs an 'Item updated' line per reparented child plus one 'Item deleted' for the article itself", async () => {
      const { records, restore } = await useTestLogSink();
      try {
        const alice = await seedUser("member", "Alice");
        const root = await seedArticle(alice.id, "Root");
        const childA = await seedArticle(alice.id, "Child A", root.id);
        const childB = await seedArticle(alice.id, "Child B", root.id);

        await deleteArticleWithChildren(db, alice, root.id, { cascade: false });

        const updated = records.filter((r) => r.message.join("") === "Item updated");
        expect(updated).toHaveLength(2);
        expect(updated.map((r) => r.properties.entityId).sort()).toEqual([childA.id, childB.id].sort());
        for (const record of updated) {
          expect(record.properties).toMatchObject({ entity: "items", kind: "page", changedFields: ["parentId"] });
        }

        const deleted = records.filter((r) => r.message.join("") === "Item deleted");
        expect(deleted).toHaveLength(1);
        expect(deleted[0].properties).toMatchObject({ entity: "items", kind: "page", entityId: root.id });
      } finally {
        await restore();
      }
    });

    it("logs no 'Item updated' line for a promote-delete with no children, only the article's own deletion", async () => {
      const { records, restore } = await useTestLogSink();
      try {
        const alice = await seedUser("member", "Alice");
        const article = await seedArticle(alice.id, "Solo");

        await deleteArticleWithChildren(db, alice, article.id, { cascade: false });

        expect(records.filter((r) => r.message.join("") === "Item updated")).toHaveLength(0);
        const deleted = records.filter((r) => r.message.join("") === "Item deleted");
        expect(deleted).toHaveLength(1);
        expect(deleted[0].properties).toMatchObject({ entity: "items", kind: "page", entityId: article.id });
      } finally {
        await restore();
      }
    });
  });

  describe("cascade path (cascade: true)", () => {
    it("deletes a full multi-level subtree and leaves unrelated articles untouched", async () => {
      const admin = await seedUser("admin", "Admin");

      const root = await seedArticle(admin.id, "Root");
      const level1 = await seedArticle(admin.id, "Level 1", root.id);
      const level2 = await seedArticle(admin.id, "Level 2", level1.id);
      const level3 = await seedArticle(admin.id, "Level 3", level2.id);

      const sibling = await seedArticle(admin.id, "Sibling of root");
      const unrelated = await seedArticle(admin.id, "Totally unrelated");

      await deleteArticleWithChildren(db, admin, root.id, { cascade: true });

      await expect(getItem(db, root.id)).rejects.toThrow();
      await expect(getItem(db, level1.id)).rejects.toThrow();
      await expect(getItem(db, level2.id)).rejects.toThrow();
      await expect(getItem(db, level3.id)).rejects.toThrow();

      await expect(getItem(db, sibling.id)).resolves.toMatchObject({ id: sibling.id });
      await expect(getItem(db, unrelated.id)).resolves.toMatchObject({ id: unrelated.id });
    });

    it("only deletes the targeted subtree, not siblings nested under the same parent", async () => {
      const admin = await seedUser("admin", "Admin");
      const parent = await seedArticle(admin.id, "Parent");
      const targetBranch = await seedArticle(admin.id, "Target branch", parent.id);
      const targetLeaf = await seedArticle(admin.id, "Target leaf", targetBranch.id);
      const otherBranch = await seedArticle(admin.id, "Other branch", parent.id);

      await deleteArticleWithChildren(db, admin, targetBranch.id, { cascade: true });

      await expect(getItem(db, targetBranch.id)).rejects.toThrow();
      await expect(getItem(db, targetLeaf.id)).rejects.toThrow();
      await expect(getItem(db, parent.id)).resolves.toMatchObject({ id: parent.id });
      await expect(getItem(db, otherBranch.id)).resolves.toMatchObject({ id: otherBranch.id });
    });

    it("lets an admin cascade-delete", async () => {
      const admin = await seedUser("admin", "Admin");
      const article = await seedArticle(admin.id, "Solo");

      await expect(
        deleteArticleWithChildren(db, admin, article.id, { cascade: true }),
      ).resolves.toBeUndefined();
    });

    it("rejects a non-admin creator with UnauthorizedError — cascade is admin-only even for your own article", async () => {
      const alice = await seedUser("member", "Alice");
      const root = await seedArticle(alice.id, "Root");
      const child = await seedArticle(alice.id, "Child", root.id);

      await expect(
        deleteArticleWithChildren(db, alice, root.id, { cascade: true }),
      ).rejects.toThrow(UnauthorizedError);

      await expect(getItem(db, root.id)).resolves.toMatchObject({ id: root.id });
      await expect(getItem(db, child.id)).resolves.toMatchObject({ id: child.id });
    });

    it("rejects a non-admin, non-creator member with UnauthorizedError", async () => {
      const alice = await seedUser("member", "Alice");
      const bob = await seedUser("member", "Bob");
      const article = await seedArticle(alice.id, "Alice's article");

      await expect(
        deleteArticleWithChildren(db, bob, article.id, { cascade: true }),
      ).rejects.toThrow(UnauthorizedError);

      await expect(getItem(db, article.id)).resolves.toMatchObject({ id: article.id });
    });

    it("deletes tags left unused after cascade-deleting a whole subtree", async () => {
      const admin = await seedUser("admin", "Admin");
      const root = await seedArticle(admin.id, "Root");
      const child = await seedArticle(admin.id, "Child", root.id);
      await setItemTags(db, root.id, ["root-tag"]);
      await setItemTags(db, child.id, ["child-tag"]);

      await deleteArticleWithChildren(db, admin, root.id, { cascade: true });

      expect(await listTags(db)).toEqual([]);
    });

    it("keeps a tag a surviving article still uses after a cascade delete", async () => {
      const admin = await seedUser("admin", "Admin");
      const root = await seedArticle(admin.id, "Root");
      const child = await seedArticle(admin.id, "Child", root.id);
      const other = await seedArticle(admin.id, "Other");
      await setItemTags(db, child.id, ["shared"]);
      await setItemTags(db, other.id, ["shared"]);

      await deleteArticleWithChildren(db, admin, root.id, { cascade: true });

      expect(await listTags(db)).toEqual(["shared"]);
    });

    it("logs one 'Item deleted' line per row removed by the cascade, not just the root", async () => {
      const { records, restore } = await useTestLogSink();
      try {
        const admin = await seedUser("admin", "Admin");
        const root = await seedArticle(admin.id, "Root");
        const level1 = await seedArticle(admin.id, "Level 1", root.id);
        const level2 = await seedArticle(admin.id, "Level 2", level1.id);
        const level3 = await seedArticle(admin.id, "Level 3", level2.id);
        const sibling = await seedArticle(admin.id, "Sibling of root");

        await deleteArticleWithChildren(db, admin, root.id, { cascade: true });

        const deleted = records.filter((r) => r.message.join("") === "Item deleted");
        expect(deleted).toHaveLength(4);
        expect(deleted.map((r) => r.properties.entityId).sort()).toEqual(
          [root.id, level1.id, level2.id, level3.id].sort(),
        );
        expect(deleted.every((r) => r.properties.entityId !== sibling.id)).toBe(true);
        for (const record of deleted) {
          expect(record.properties).toMatchObject({ entity: "items", kind: "page" });
        }
      } finally {
        await restore();
      }
    });
  });
});
