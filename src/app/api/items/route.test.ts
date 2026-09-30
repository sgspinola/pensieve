import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { items, users } from "@/db/schema";
import { encodeUserHeader } from "@/lib/auth-cookies";
import type { SessionUser } from "@/services/auth/session";
import { setItemTags } from "@/services/tags/tags";

// Route-level auth/DB wiring for the GET tag-filter tests below — mirrors
// src/app/api/flashcards/route.test.ts's own mock setup.
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userHeader: undefined as string | undefined,
}));

vi.mock("@/db/client", () => ({
  getDb: () => state.db,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.userHeader ? { "x-pensieve-user": state.userHeader } : {}),
}));

const { MAX_PAGE_SIZE, GET, POST } = await import("./route");

// GET /api/items's `?limit=`/`?kind=` query-param validation (ticket 19):
// both now run through shared Zod schemas (src/lib/query-schemas.ts) via
// parseOrThrow, replacing the removed ad hoc parseLimitParam (silent
// clamp-to-default) and `.filter(isCreatableItemKind)` (silent drop)
// behavior with fail-closed rejection. The schemas' own field-by-field
// coverage lives in src/lib/query-schemas.test.ts — this only confirms the
// route actually wires them in and maps a rejection to the standard 400
// envelope. Needs a real authenticated session (GET calls getCurrentUser()
// before parsing any query param), hence the same DB/user setup as the
// tag-filtering tests below.
describe("GET /api/items — limit/kind query-param validation (ticket 19)", () => {
  let db: TestDatabase;
  let teardown: (() => Promise<void>) | undefined;
  let user: SessionUser;

  beforeEach(async () => {
    const testDb = await createTestDb();
    db = testDb.db;
    teardown = testDb.teardown;
    state.db = db;

    const [row] = await db.insert(users).values({ displayName: "Alice", role: "member" }).returning();
    user = { id: row.id, displayName: row.displayName, role: row.role };
    state.userHeader = encodeUserHeader(user);
  });

  afterEach(async () => {
    state.db = undefined;
    state.userHeader = undefined;
    if (!teardown) return;
    const cleanup = teardown;
    teardown = undefined;
    await cleanup();
  });

  it("accepts a valid in-range `?limit=`", async () => {
    const response = await GET(new Request("http://localhost/api/items?limit=5"));
    expect(response.status).toBe(200);
  });

  it("rejects a non-numeric `?limit=` with a VALIDATION error envelope", async () => {
    const response = await GET(new Request("http://localhost/api/items?limit=not-a-number"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.issues).toEqual([{ field: "", message: "limit must be a positive integer" }]);
  });

  it("rejects an out-of-range `?limit=` (over MAX_PAGE_SIZE) with a VALIDATION error envelope", async () => {
    const response = await GET(new Request(`http://localhost/api/items?limit=${MAX_PAGE_SIZE + 1}`));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.issues).toEqual([
      { field: "", message: `limit must be between 1 and ${MAX_PAGE_SIZE}` },
    ]);
  });

  it("rejects an invalid `?kind=` with a VALIDATION error envelope", async () => {
    const response = await GET(new Request("http://localhost/api/items?kind=bogus"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.issues).toEqual([
      { field: "[0]", message: 'kind must be "link", "tool", "article", or "page"' },
    ]);
  });

  it("accepts every valid `?kind=` value, including page", async () => {
    const response = await GET(new Request("http://localhost/api/items?kind=page"));
    expect(response.status).toBe(200);
  });
});

// GET /api/items honoring `?tags=` (bug found by code review): ItemsLibrary's
// `buildLoadMoreQuery` appends the active tag filter to every infinite-scroll
// request, and the route must actually forward it to `listItems`/`countItems`
// — otherwise a tag-filtered list silently reverts to unfiltered once the
// user scrolls past the SSR first page.
describe("GET /api/items — tag filtering", () => {
  let db: TestDatabase;
  let teardown: (() => Promise<void>) | undefined;
  let user: SessionUser;

  beforeEach(async () => {
    const testDb = await createTestDb();
    db = testDb.db;
    teardown = testDb.teardown;
    state.db = db;

    const [row] = await db.insert(users).values({ displayName: "Alice", role: "member" }).returning();
    user = { id: row.id, displayName: row.displayName, role: row.role };
    state.userHeader = encodeUserHeader(user);
  });

  afterEach(async () => {
    state.db = undefined;
    state.userHeader = undefined;
    if (!teardown) return;
    const cleanup = teardown;
    teardown = undefined;
    await cleanup();
  });

  async function seedLink(title: string, tags: string[]) {
    const [row] = await db
      .insert(items)
      .values({ kind: "link", url: `https://example.com/${title}`, title, createdBy: user.id })
      .returning();
    await setItemTags(db, row.id, tags);
    return row;
  }

  it("narrows the unpaginated response to items matching the given tag", async () => {
    await seedLink("Matches", ["networking"]);
    await seedLink("Does not match", ["cryptography"]);

    const response = await GET(new Request("http://localhost/api/items?tags=networking"));
    const body = await response.json();

    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe("Matches");
    expect(body.count).toBe(1);
  });

  it("narrows a paginated (`?limit=`) response to items matching the given tag", async () => {
    await seedLink("Matches", ["networking"]);
    await seedLink("Does not match", ["cryptography"]);

    const response = await GET(new Request("http://localhost/api/items?tags=networking&limit=30"));
    const body = await response.json();

    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe("Matches");
    expect(body.count).toBe(1);
  });
});

// POST /api/items's request-shape validation (ticket 05, schema added in
// ticket 17 — see ./schema.test.ts for the schema's own field-by-field
// coverage): a rejected body throws `ValidationError` that withErrorHandling
// maps to the shared `{ error: { code, message, requestId, issues } }`
// envelope, same as every other thrown AppError. None of these reach the
// database (they throw before getCurrentUser()/createItem), so no DB/auth
// setup is needed.
describe("POST /api/items — validation", () => {
  function postWith(body: unknown): Promise<Response> {
    return POST(
      new Request("http://localhost/api/items", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  }

  it.each([
    [{}, [{ field: "kind", message: 'kind must be "link", "tool", "article", or "page"' }]],
    [{ kind: "bogus" }, [{ field: "kind", message: 'kind must be "link", "tool", "article", or "page"' }]],
    [
      { kind: "page" },
      [
        { field: "title", message: "title is required" },
        { field: "content", message: "content is required" },
      ],
    ],
    [
      { kind: "page", title: "   " },
      [
        { field: "title", message: "title is required" },
        { field: "content", message: "content is required" },
      ],
    ],
    [{ kind: "page", title: "T" }, [{ field: "content", message: "content is required" }]],
    [{ kind: "page", title: "T", content: "   " }, [{ field: "content", message: "content is required" }]],
    [{ kind: "link" }, [{ field: "url", message: "url is required" }]],
    [{ kind: "link", url: "   " }, [{ field: "url", message: "url is required" }]],
    [
      { kind: "link", url: "https://example.com", tags: "not-an-array" },
      [{ field: "tags", message: "tags must be an array of strings" }],
    ],
    [
      { kind: "link", url: "https://example.com", tags: [1, 2] },
      [{ field: "tags", message: "tags must be an array of strings" }],
    ],
    [
      { kind: "link", url: "https://example.com", parentId: 5 },
      [{ field: "parentId", message: "parentId must be a string or null" }],
    ],
  ])("rejects %j with a VALIDATION error envelope", async (body, issues) => {
    const response = await postWith(body);

    expect(response.status).toBe(400);
    const responseBody = await response.json();
    expect(responseBody.error.code).toBe("VALIDATION");
    expect(responseBody.error.issues).toEqual(issues);
  });
});
