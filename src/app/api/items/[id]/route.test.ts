import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { users } from "@/db/schema";
import { encodeUserHeader } from "@/lib/auth-cookies";
import type { SessionUser } from "@/services/auth/session";
import { createItem } from "@/services/items/items";

// Same route-level auth/DB mocking approach as
// src/app/api/flashcards/[id]/route.test.ts: PATCH/DELETE call
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

// Ticket 15: the `id` route param is now UUID-checked (via parseOrThrow +
// request-fields.ts's idParamSchema) before it reaches the DB query, so a
// malformed id — e.g. from a stray link or typo — returns a clean
// ValidationError-backed 400 instead of an unhandled Postgres error surfacing
// as a 500. A well-formed but nonexistent UUID is untouched by this check and
// must still reach updateItem/deleteItem to produce their existing
// NotFoundError-backed 404.
describe("PATCH and DELETE /api/items/[id] — id param validation (ticket 15)", () => {
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
    return new Request("http://localhost/api/items/x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function deleteRequest(): Request {
    return new Request("http://localhost/api/items/x", { method: "DELETE" });
  }

  it("PATCH returns 400 with a field-level issue when id is not a valid UUID", async () => {
    const response = await PATCH(patchRequest({ title: "Revised" }), {
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
    const response = await PATCH(patchRequest({ title: "Revised" }), {
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

  it("PATCH succeeds with a valid, existing UUID (unaffected by the new check)", async () => {
    const item = await createItem(db, {
      creatorId: user.id,
      kind: "page",
      title: "Original title",
      content: "hello",
    });

    const response = await PATCH(patchRequest({ title: "Revised title" }), {
      params: Promise.resolve({ id: item.id }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.item.title).toBe("Revised title");
  });

  it("DELETE succeeds with a valid, existing UUID (unaffected by the new check)", async () => {
    const item = await createItem(db, {
      creatorId: user.id,
      kind: "page",
      title: "Original title",
      content: "hello",
    });

    const response = await DELETE(deleteRequest(), { params: Promise.resolve({ id: item.id }) });

    expect(response.status).toBe(204);
  });
});

// PATCH /api/items/[id]'s update-body validation (ticket 17 — see
// ./schema.test.ts for the schema's own field-by-field coverage): this only
// confirms the route wires updateItemBodySchema through parseOrThrow into
// the same `{ error: { code, issues } }` envelope every other AppError uses,
// and that a rejected kind change never reaches updateItem.
describe("PATCH /api/items/[id] — body validation (ticket 17)", () => {
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
    return new Request("http://localhost/api/items/x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects an attempted kind change without reaching updateItem", async () => {
    const item = await createItem(db, {
      creatorId: user.id,
      kind: "page",
      title: "Original title",
      content: "hello",
    });

    const response = await PATCH(patchRequest({ kind: "link" }), {
      params: Promise.resolve({ id: item.id }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.issues).toEqual([{ field: "kind", message: "kind cannot be changed" }]);
  });

  it("rejects tags that are not a string array", async () => {
    const item = await createItem(db, {
      creatorId: user.id,
      kind: "page",
      title: "Original title",
      content: "hello",
    });

    const response = await PATCH(patchRequest({ tags: "not-an-array" }), {
      params: Promise.resolve({ id: item.id }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.issues).toEqual([{ field: "tags", message: "tags must be an array of strings" }]);
  });
});

// DELETE /api/items/[id]'s `?cascade=` query-param validation (ticket 19 —
// see src/lib/query-schemas.test.ts for cascadeQuerySchema's own
// field-by-field coverage): confirms the route wires cascadeQuerySchema
// through parseOrThrow into the standard `{ error: { code, issues } }`
// envelope, replacing the previous `searchParams.get("cascade") === "true"`
// check that silently treated any malformed value as `false`.
describe("DELETE /api/items/[id] — cascade query-param validation (ticket 19)", () => {
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

  it("rejects a malformed `?cascade=` with a VALIDATION error envelope, without deleting the item", async () => {
    const item = await createItem(db, {
      creatorId: user.id,
      kind: "page",
      title: "Original title",
      content: "hello",
    });

    const response = await DELETE(
      new Request(`http://localhost/api/items/${item.id}?cascade=yes`, { method: "DELETE" }),
      { params: Promise.resolve({ id: item.id }) },
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.issues).toEqual([{ field: "", message: 'cascade must be "true" or "false"' }]);
  });

  it("accepts `?cascade=true` and deletes the item (admin-only, per deleteArticleWithChildren)", async () => {
    const item = await createItem(db, {
      creatorId: user.id,
      kind: "page",
      title: "Original title",
      content: "hello",
    });

    // Cascade delete of a page is admin-only (see items.ts's deleteItem
    // comment) — a plain member `?cascade=true` request is expected to
    // reach that check and 401, not the cascade validation this test is
    // about, so this needs its own admin actor.
    const [adminRow] = await db.insert(users).values({ displayName: "Admin", role: "admin" }).returning();
    state.userHeader = encodeUserHeader({ id: adminRow.id, displayName: adminRow.displayName, role: adminRow.role });

    const response = await DELETE(
      new Request(`http://localhost/api/items/${item.id}?cascade=true`, { method: "DELETE" }),
      { params: Promise.resolve({ id: item.id }) },
    );

    expect(response.status).toBe(204);
  });

  it("treats an absent `?cascade=` as false, same as before this ticket", async () => {
    const item = await createItem(db, {
      creatorId: user.id,
      kind: "page",
      title: "Original title",
      content: "hello",
    });

    const response = await DELETE(new Request(`http://localhost/api/items/${item.id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: item.id }),
    });

    expect(response.status).toBe(204);
  });
});
