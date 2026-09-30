import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { users } from "@/db/schema";
import { encodeUserHeader } from "@/lib/auth-cookies";
import type { SessionUser } from "@/services/auth/session";

// Route-level auth/DB wiring for the POST tag-validation tests below: the
// route calls getCurrentUser() (which reads the `x-pensieve-user` header
// via next/headers — set by src/proxy.ts in production) and getDb() (a
// lazily-created singleton connection) — neither is otherwise injectable,
// so both are mocked here to route through a per-test `state.db`/
// `state.userHeader` instead. `vi.hoisted` is required because vi.mock
// factories run before this module's own top-level `const`s are
// initialized.
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

const { MAX_PAGE_SIZE, buildFlashcardsResponseBody, GET, POST } = await import("./route");

// GET /api/flashcards's `?limit=` query-param validation (ticket 19): now
// runs through the shared limitQuerySchema (src/lib/query-schemas.ts) via
// parseOrThrow, replacing the removed ad hoc parseLimitParam's silent
// clamp-to-default with fail-closed rejection. The schema's own
// field-by-field coverage lives in src/lib/query-schemas.test.ts — this
// only confirms the route wires it in and maps a rejection to the standard
// 400 envelope. Needs a real authenticated session (GET calls
// getCurrentUser() before parsing `?limit=`), hence the DB/user setup below.
describe("GET /api/flashcards — limit query-param validation (ticket 19)", () => {
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
    const response = await GET(new Request("http://localhost/api/flashcards?limit=5"));
    expect(response.status).toBe(200);
  });

  it("rejects a non-numeric `?limit=` with a VALIDATION error envelope", async () => {
    const response = await GET(new Request("http://localhost/api/flashcards?limit=not-a-number"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.issues).toEqual([{ field: "", message: "limit must be a positive integer" }]);
  });

  it("rejects an out-of-range `?limit=` (over MAX_PAGE_SIZE) with a VALIDATION error envelope", async () => {
    const response = await GET(new Request(`http://localhost/api/flashcards?limit=${MAX_PAGE_SIZE + 1}`));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.issues).toEqual([
      { field: "", message: `limit must be between 1 and ${MAX_PAGE_SIZE}` },
    ]);
  });
});

// GET /api/flashcards's other own new logic (ticket 01): folding the
// separately-fetched true count into the paginated page's response body as
// `total`, without disturbing `flashcards`/`nextCursor` — the existing
// pagination contract this route's other callers (and FlashcardsManager's
// infinite scroll) still rely on. The count query itself (its tag-filter
// scoping, its independence from limit/cursor) is covered against a real
// database in src/services/flashcards/flashcards.test.ts — this only covers
// the pure response-shape composition this route adds on top.
describe("buildFlashcardsResponseBody", () => {
  it("adds `total` alongside the existing `flashcards`/`nextCursor` fields", () => {
    const page = { flashcards: [], nextCursor: null };

    expect(buildFlashcardsResponseBody(page, 42)).toEqual({
      flashcards: [],
      nextCursor: null,
      total: 42,
    });
  });

  it("leaves `flashcards`/`nextCursor` untouched, whatever they are", () => {
    const page = { flashcards: [{ id: "card-1" }], nextCursor: "some-cursor" };

    const body = buildFlashcardsResponseBody(page as never, 7);

    expect(body.flashcards).toBe(page.flashcards);
    expect(body.nextCursor).toBe("some-cursor");
    expect(body.total).toBe(7);
  });
});

// POST /api/flashcards's tag validation (ticket 04): createFlashcard now
// rejects zero tags with a ValidationError, and toErrorResponse (see
// src/lib/api-errors.ts) already maps that to a 400 — this confirms that
// mapping actually happens through the route, not just at the service
// layer, using a real test database via the getDb() mock above.
describe("POST /api/flashcards — mandatory tags (ticket 04)", () => {
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

  function postRequest(body: unknown): Request {
    return new Request("http://localhost/api/flashcards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 400 with an error body when tags is omitted entirely", async () => {
    const response = await POST(
      postRequest({ front: "What is TCP?", back: "A transport protocol.", source: "https://example.com" }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(body.error.requestId).toBeUndefined();
  });

  it("returns 400 with an error body when tags is an explicit empty array", async () => {
    const response = await POST(
      postRequest({
        front: "What is TCP?",
        back: "A transport protocol.",
        source: "https://example.com",
        tags: [],
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(typeof body.error.message).toBe("string");
  });

  it("returns 400 when tags are all blank/whitespace-only", async () => {
    const response = await POST(
      postRequest({
        front: "What is TCP?",
        back: "A transport protocol.",
        source: "https://example.com",
        tags: ["", "   "],
      }),
    );

    expect(response.status).toBe(400);
  });

  it("returns 201 when at least one non-blank tag is given", async () => {
    const response = await POST(
      postRequest({
        front: "What is TCP?",
        back: "A transport protocol.",
        source: "https://example.com",
        tags: ["networking"],
      }),
    );

    expect(response.status).toBe(201);
  });
});
