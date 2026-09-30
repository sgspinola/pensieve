import { describe, expect, it } from "vitest";
import { buildItemRequest, isItemFormDirty, type ItemFormValues } from "./ItemForm";

/**
 * `ItemForm` is shared between `/items/new` (create), `/wiki`'s inline
 * creation panel (also create, via `defaultKind`/`lockKind`/`defaultParentId`),
 * and the ticket-07 edit modal (edit) — these are the two pure logic seams it
 * exports so create-vs-edit request-building (across all three kind
 * variants) and the modal's dirty-check are unit-testable without rendering
 * the component (which pulls in `MarkdownEditor`/`@uiw/react-md-editor` —
 * deliberately never rendered under this repo's jsdom-less Vitest, same
 * reasoning as `FlashcardForm.test.ts`).
 */

const linkValues: ItemFormValues = {
  kind: "link",
  url: "https://example.com  ",
  title: "Example",
  description: "A description",
  notes: "Some notes",
  content: "",
  parentId: null,
  tags: ["x"],
};

const toolValues: ItemFormValues = { ...linkValues, kind: "tool", url: "https://example.com/tool  " };

const articleValues: ItemFormValues = { ...linkValues, kind: "article", url: "https://example.com/article  " };

const pageValues: ItemFormValues = {
  kind: "page",
  url: "",
  title: "Page title",
  description: "",
  notes: "Some notes",
  content: "Page body",
  parentId: "parent-1",
  tags: ["wiki"],
};

describe("buildItemRequest", () => {
  it("posts to /api/items for a new link, trimming the url and including kind", () => {
    expect(buildItemRequest({ kind: "create" }, linkValues)).toEqual({
      url: "/api/items",
      method: "POST",
      body: {
        kind: "link",
        url: "https://example.com",
        title: "Example",
        description: "A description",
        notes: "Some notes",
        tags: ["x"],
      },
    });
  });

  it("posts to /api/items for a new tool, trimming the url and including kind", () => {
    expect(buildItemRequest({ kind: "create" }, toolValues)).toEqual({
      url: "/api/items",
      method: "POST",
      body: {
        kind: "tool",
        url: "https://example.com/tool",
        title: "Example",
        description: "A description",
        notes: "Some notes",
        tags: ["x"],
      },
    });
  });

  it("posts to /api/items for a new article, trimming the url and including kind (ticket 02: shaped like a link)", () => {
    expect(buildItemRequest({ kind: "create" }, articleValues)).toEqual({
      url: "/api/items",
      method: "POST",
      body: {
        kind: "article",
        url: "https://example.com/article",
        title: "Example",
        description: "A description",
        notes: "Some notes",
        tags: ["x"],
      },
    });
  });

  it("posts to /api/items for a new page, with content/parentId instead of url/description", () => {
    expect(buildItemRequest({ kind: "create" }, pageValues)).toEqual({
      url: "/api/items",
      method: "POST",
      body: {
        kind: "page",
        title: "Page title",
        content: "Page body",
        notes: "Some notes",
        tags: ["wiki"],
        parentId: "parent-1",
      },
    });
  });

  it("patches /api/items/[id] for an edited link, with no kind field", () => {
    expect(buildItemRequest({ kind: "edit", itemId: "item-1" }, linkValues)).toEqual({
      url: "/api/items/item-1",
      method: "PATCH",
      body: {
        url: "https://example.com",
        title: "Example",
        description: "A description",
        notes: "Some notes",
        tags: ["x"],
      },
    });
  });

  it("patches /api/items/[id] for an edited tool, with no kind field", () => {
    expect(buildItemRequest({ kind: "edit", itemId: "item-2" }, toolValues)).toEqual({
      url: "/api/items/item-2",
      method: "PATCH",
      body: {
        url: "https://example.com/tool",
        title: "Example",
        description: "A description",
        notes: "Some notes",
        tags: ["x"],
      },
    });
  });

  it("patches /api/items/[id] for an edited article, with no kind field", () => {
    expect(buildItemRequest({ kind: "edit", itemId: "item-3" }, articleValues)).toEqual({
      url: "/api/items/item-3",
      method: "PATCH",
      body: {
        url: "https://example.com/article",
        title: "Example",
        description: "A description",
        notes: "Some notes",
        tags: ["x"],
      },
    });
  });

  it("patches /api/items/[id] for an edited page, with no kind field", () => {
    expect(buildItemRequest({ kind: "edit", itemId: "item-4" }, pageValues)).toEqual({
      url: "/api/items/item-4",
      method: "PATCH",
      body: {
        title: "Page title",
        content: "Page body",
        notes: "Some notes",
        tags: ["wiki"],
        parentId: "parent-1",
      },
    });
  });
});

describe("isItemFormDirty", () => {
  it("is false when current values exactly match the initial values", () => {
    expect(isItemFormDirty(linkValues, linkValues)).toBe(false);
    expect(isItemFormDirty(pageValues, pageValues)).toBe(false);
  });

  it("is true when title changed", () => {
    expect(isItemFormDirty({ ...linkValues, title: "New title" }, linkValues)).toBe(true);
  });

  it("is true when url changed", () => {
    expect(isItemFormDirty({ ...linkValues, url: "https://other.example.com" }, linkValues)).toBe(true);
  });

  it("is true when description changed", () => {
    expect(isItemFormDirty({ ...linkValues, description: "New description" }, linkValues)).toBe(true);
  });

  it("is true when content changed", () => {
    expect(isItemFormDirty({ ...pageValues, content: "New body" }, pageValues)).toBe(true);
  });

  it("is true when notes changed", () => {
    expect(isItemFormDirty({ ...linkValues, notes: "New notes" }, linkValues)).toBe(true);
  });

  it("is true when parentId changed", () => {
    expect(isItemFormDirty({ ...pageValues, parentId: "parent-2" }, pageValues)).toBe(true);
  });

  it("is true when a tag was added", () => {
    expect(isItemFormDirty({ ...linkValues, tags: ["x", "y"] }, linkValues)).toBe(true);
  });

  it("is true when a tag was removed", () => {
    expect(isItemFormDirty({ ...linkValues, tags: [] }, linkValues)).toBe(true);
  });
});
