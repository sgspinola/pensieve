import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { users } from "@/db/schema";
import { encodeUserHeader } from "@/lib/auth-cookies";
import type { SessionUser } from "@/services/auth/session";

// Route-level auth/DB wiring, same pattern as src/app/api/items/route.test.ts:
// GET calls getCurrentUser() (via next/headers) and getDb(), neither
// otherwise injectable in a unit test.
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

const { GET } = await import("./route");

// GET /api/items/export's `?kind=` query-param validation (ticket 19): now
// runs through exportKindParamSchema (src/lib/query-schemas.ts) via
// parseOrThrow, replacing the removed ad hoc parseKindParam + hand-rolled
// 400 with the same ValidationError-backed envelope every other
// query/body schema in this codebase uses. The schema's own field-by-field
// coverage (every valid kind, "page" rejected, missing/unrecognized
// rejected) lives in src/lib/query-schemas.test.ts — this only confirms the
// route wires it in and maps a rejection to the standard 400 envelope. The
// export content itself is covered against a real database in
// src/services/items/items-export.test.ts.
describe("GET /api/items/export — kind query-param validation (ticket 19)", () => {
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

  it.each(["link", "tool", "article"] as const)("accepts %s and returns a markdown file", async (kind) => {
    const response = await GET(new Request(`http://localhost/api/items/export?kind=${kind}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
  });

  it("rejects page — wiki pages are never a content type here", async () => {
    const response = await GET(new Request("http://localhost/api/items/export?kind=page"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.issues).toEqual([
      { field: "", message: 'kind must be "link", "tool", or "article"' },
    ]);
  });

  it("rejects a missing kind with a VALIDATION error envelope", async () => {
    const response = await GET(new Request("http://localhost/api/items/export"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.issues).toEqual([
      { field: "", message: 'kind must be "link", "tool", or "article"' },
    ]);
  });

  it("rejects an unrecognized kind with a VALIDATION error envelope", async () => {
    const response = await GET(new Request("http://localhost/api/items/export?kind=bogus"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.issues).toEqual([
      { field: "", message: 'kind must be "link", "tool", or "article"' },
    ]);
  });
});
