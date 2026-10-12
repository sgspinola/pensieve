import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../db/migrations";
import { createTestDb } from "@/test/db";
import { readJournal } from "./journal";
import { checkSchemaCompatibility } from "./schema-check";

/**
 * Ticket 44: the app's two-sided startup check (spec 13, "Startup check"),
 * given a journal and a database state. Both come from the migrator's
 * fixtures under db/fixtures/migrations/: v1 is one additive migration, v2
 * adds a breaking one (0001_drop_widget_name), v3 adds another additive one.
 * Each test brings a fresh database to a state with the DB image's migrator
 * (or drizzle's own, which is what drizzle-kit runs), then checks an app
 * built against one of those journals.
 */

const journalOf = (version: string) =>
  readJournal(path.join(process.cwd(), "db", "fixtures", "migrations", version));

let sql: postgres.Sql;
let teardown: () => Promise<void>;

beforeEach(async () => {
  ({ sql, teardown } = await createTestDb({ migrate: false }));
  await sql.unsafe("SET client_min_messages = warning");
});

afterEach(async () => {
  await teardown();
});

async function migrateTo(version: string): Promise<void> {
  await runMigrations(sql, {
    migrationsFolder: path.join(process.cwd(), "db", "fixtures", "migrations", version),
    allowBreaking: true,
  });
}

describe("checkSchemaCompatibility", () => {
  it("accepts a database that matches the app's journal exactly", async () => {
    await migrateTo("v2");

    await expect(checkSchemaCompatibility(sql, journalOf("v2"))).resolves.toBeUndefined();
  });

  it("rejects a database missing a migration in the app's journal (database too old), naming it", async () => {
    await migrateTo("v1");

    const check = checkSchemaCompatibility(sql, journalOf("v2"));

    await expect(check).rejects.toThrow(/database is too old.*: 0001_drop_widget_name\b/);
    await expect(check).rejects.not.toThrow(/0000_create_widgets/);
  });

  it("rejects a database holding a breaking migration the app's journal lacks (app too old), naming it", async () => {
    await migrateTo("v2");

    await expect(checkSchemaCompatibility(sql, journalOf("v1"))).rejects.toThrow(
      /app is too old.*: 0001_drop_widget_name\b/,
    );
  });

  it("accepts a database ahead of the app's journal only by additive migrations", async () => {
    await migrateTo("v3");

    await expect(checkSchemaCompatibility(sql, journalOf("v2"))).resolves.toBeUndefined();
  });

  describe("on a database migrated by drizzle-kit, with no pensieve_meta (local dev, unit CI, e2e)", () => {
    beforeEach(async () => {
      // drizzle-orm's migrator, which drizzle-kit shares: it never creates
      // pensieve_meta.schema_compat, so no breaking migration is on record.
      await migrate(drizzle(sql), {
        migrationsFolder: path.join(process.cwd(), "db", "fixtures", "migrations", "v2"),
      });
    });

    it("accepts it when it has every migration in the app's journal", async () => {
      await expect(checkSchemaCompatibility(sql, journalOf("v2"))).resolves.toBeUndefined();
    });

    it("treats it as holding no breaking migration, so an older app's journal is accepted too", async () => {
      await expect(checkSchemaCompatibility(sql, journalOf("v1"))).resolves.toBeUndefined();
    });
  });

  it("rejects a database no migration was ever applied to as too old", async () => {
    await expect(checkSchemaCompatibility(sql, journalOf("v1"))).rejects.toThrow(
      /database is too old.*: 0000_create_widgets\b/,
    );
  });
});
