import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { createPing, getPing } from "./ping";

describe("ping service (test harness demonstration)", () => {
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

  it("creates a row and reads it back via a real query", async () => {
    const created = await createPing(db, "hello from the test harness");

    const found = await getPing(db, created.id);

    expect(found).not.toBeNull();
    expect(found?.message).toBe("hello from the test harness");
  });

  it("returns null for a ping that does not exist", async () => {
    const found = await getPing(db, 999999);

    expect(found).toBeNull();
  });
});
