import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { users } from "@/db/schema";
import { encodeUserHeader } from "@/lib/auth-cookies";
import type { SessionUser } from "@/services/auth/session";
import { createFlashcard } from "@/services/flashcards/flashcards";
import { getFlashcardTagNames } from "@/services/tags/tags";

// Same route-level auth/DB mocking approach as
// src/app/api/flashcards/route.test.ts's POST tests: PATCH calls
// getCurrentUser() (reads next/headers) and getDb() (a lazy singleton),
// neither otherwise injectable in a unit test, so both are routed through a
// per-test `state.db`/`state.userHeader` via vi.mock. vi.hoisted is
// required so the mock factories (hoisted above this module's own imports)
// can reference `state` without a temporal-dead-zone error.
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

const { PATCH, DELETE } = await import("./route");

// PATCH /api/flashcards/[id]'s tag validation (ticket 04): updateFlashcard
// now rejects an explicit empty (or all-blank) `tags` array with a
// ValidationError, and toErrorResponse (src/lib/api-errors.ts) already maps
// that to a 400 — this confirms that mapping actually happens through the
// route, using a real test database via the getDb() mock above.
describe("PATCH /api/flashcards/[id] — mandatory tags (ticket 04)", () => {
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

  function patchRequest(body: unknown): Request {
    return new Request("http://localhost/api/flashcards/x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 400 with an error body when tags is an explicit empty array, and leaves the card's tags untouched", async () => {
    const card = await createFlashcard(db, {
      creatorId: user.id,
      front: "What is TCP?",
      back: "A transport protocol.",
      source: "https://example.com",
      tags: ["networking"],
    });

    const response = await PATCH(patchRequest({ tags: [] }), { params: Promise.resolve({ id: card.id }) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(body.error.requestId).toBeUndefined();
    expect(await getFlashcardTagNames(db, card.id)).toEqual(["networking"]);
  });

  it("returns 400 when tags are all blank/whitespace-only", async () => {
    const card = await createFlashcard(db, {
      creatorId: user.id,
      front: "What is TCP?",
      back: "A transport protocol.",
      source: "https://example.com",
      tags: ["networking"],
    });

    const response = await PATCH(patchRequest({ tags: ["", "  "] }), { params: Promise.resolve({ id: card.id }) });

    expect(response.status).toBe(400);
  });

  it("returns 200 and leaves tags unchanged when `tags` is omitted from the body", async () => {
    const card = await createFlashcard(db, {
      creatorId: user.id,
      front: "What is TCP?",
      back: "A transport protocol.",
      source: "https://example.com",
      tags: ["networking"],
    });

    const response = await PATCH(patchRequest({ front: "Revised" }), { params: Promise.resolve({ id: card.id }) });

    expect(response.status).toBe(200);
    expect(await getFlashcardTagNames(db, card.id)).toEqual(["networking"]);
  });

  it("returns 200 when tags is replaced with a non-empty array", async () => {
    const card = await createFlashcard(db, {
      creatorId: user.id,
      front: "What is TCP?",
      back: "A transport protocol.",
      source: "https://example.com",
      tags: ["networking"],
    });

    const response = await PATCH(patchRequest({ tags: ["revised"] }), { params: Promise.resolve({ id: card.id }) });

    expect(response.status).toBe(200);
    expect(await getFlashcardTagNames(db, card.id)).toEqual(["revised"]);
  });
});

// Ticket 15: the `id` route param is now UUID-checked (via parseOrThrow +
// request-fields.ts's idParamSchema) before it reaches the DB query, so a
// malformed id — e.g. from a stray link or typo — returns a clean
// ValidationError-backed 400 instead of an unhandled Postgres error surfacing
// as a 500. A well-formed but nonexistent UUID is untouched by this check and
// must still reach updateFlashcard/deleteFlashcard to produce their existing
// NotFoundError-backed 404.
describe("PATCH and DELETE /api/flashcards/[id] — id param validation (ticket 15)", () => {
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

  function patchRequest(body: unknown): Request {
    return new Request("http://localhost/api/flashcards/x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function deleteRequest(): Request {
    return new Request("http://localhost/api/flashcards/x", { method: "DELETE" });
  }

  it("PATCH returns 400 with a field-level issue when id is not a valid UUID", async () => {
    const response = await PATCH(patchRequest({ front: "Revised" }), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.issues).toEqual([{ field: "", message: expect.any(String) }]);
  });

  it("DELETE returns 400 with a field-level issue when id is not a valid UUID", async () => {
    const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: "not-a-uuid" }) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.issues).toEqual([{ field: "", message: expect.any(String) }]);
  });

  it("PATCH with a well-formed but nonexistent UUID still reaches the service layer and 404s", async () => {
    const response = await PATCH(patchRequest({ front: "Revised" }), {
      params: Promise.resolve({ id: "3fa85f64-5717-4562-b3fc-2c963f66afa6" }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("DELETE with a well-formed but nonexistent UUID still reaches the service layer and 404s", async () => {
    const response = await DELETE(deleteRequest(), {
      params: Promise.resolve({ id: "3fa85f64-5717-4562-b3fc-2c963f66afa6" }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("DELETE succeeds with a valid, existing UUID (unaffected by the new check)", async () => {
    const card = await createFlashcard(db, {
      creatorId: user.id,
      front: "What is TCP?",
      back: "A transport protocol.",
      source: "https://example.com",
      tags: ["networking"],
    });

    const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: card.id }) });

    expect(response.status).toBe(204);
  });
});
