import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDatabase } from "@/test/db";
import { sessions, users } from "@/db/schema";
import { sha256Hex } from "@/lib/crypto";
import { useTestLogSink } from "@/test/log-sink";
import { createSession, deleteSession } from "@/services/auth/session";

describe("session mutation logging (ticket 10)", () => {
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

  async function seedUser() {
    const [row] = await db.insert(users).values({ displayName: "Alice", role: "member" }).returning();
    return row;
  }

  it("logs entity/entityId on createSession success", async () => {
    const alice = await seedUser();
    const { records, restore } = await useTestLogSink();

    let session;
    try {
      session = await createSession(db, alice.id);
    } finally {
      await restore();
    }

    const expectedId = sha256Hex(session.token);
    const record = records.find((r) => r.properties.entity === "sessions");
    expect(record?.properties).toMatchObject({ entity: "sessions", entityId: expectedId });
  });

  it("logs entity/entityId on deleteSession success", async () => {
    const alice = await seedUser();
    const session = await createSession(db, alice.id);
    const expectedId = sha256Hex(session.token);

    const { records, restore } = await useTestLogSink();
    try {
      await deleteSession(db, session.token);
    } finally {
      await restore();
    }

    const record = records.find((r) => r.properties.entity === "sessions");
    expect(record?.properties).toMatchObject({ entity: "sessions", entityId: expectedId });

    const rows = await db.select().from(sessions).where(eq(sessions.id, expectedId));
    expect(rows).toHaveLength(0);
  });
});
