import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { runMigrations } from "./migrations";

/**
 * Ticket 43: the DB image's migrator (spec 13, "Migrator behaviour"), against
 * a fresh database per test and the fixture folders under
 * db/fixtures/migrations/. Each fixture version extends the previous one, as
 * the real drizzle/ folder grows: v1 is one additive migration, v2 adds a
 * breaking one (`-- pensieve:breaking`), v3 adds another additive one.
 * `failing` adds a migration whose second statement fails.
 */

const fixture = (name: string) => path.join(process.cwd(), "db", "fixtures", "migrations", name);

let sql: postgres.Sql;
let teardown: () => Promise<void>;

beforeEach(async () => {
  ({ sql, teardown } = await createTestDb({ migrate: false }));
  await sql.unsafe("SET client_min_messages = warning");
});

afterEach(async () => {
  await teardown();
});

async function tableExists(name: string): Promise<boolean> {
  const [{ exists }] = await sql<{ exists: boolean }[]>`select to_regclass(${name}) is not null as exists`;
  return exists;
}

async function widgetColumns(): Promise<string[]> {
  const rows = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns where table_name = 'widgets' order by column_name
  `;
  return rows.map((r) => r.column_name);
}

async function recordedBreakingTag(): Promise<string | null> {
  const rows = await sql<{ breaking_tag: string | null }[]>`select breaking_tag from pensieve_meta.schema_compat`;
  expect(rows).toHaveLength(1);
  return rows[0].breaking_tag;
}

describe("runMigrations", () => {
  it("applies pending additive migrations and records that no breaking one was ever applied", async () => {
    await runMigrations(sql, { migrationsFolder: fixture("v1"), allowBreaking: false });

    expect(await tableExists("public.widgets")).toBe(true);
    expect(await recordedBreakingTag()).toBeNull();
  });

  it("refuses a batch with a pending breaking migration, naming it, and applies none of the batch", async () => {
    const run = runMigrations(sql, { migrationsFolder: fixture("v2"), allowBreaking: false });

    await expect(run).rejects.toThrow(/breaking migration\(s\) pending: 0001_drop_widget_name\b/);
    await expect(run).rejects.not.toThrow(/0000_create_widgets/);
    expect(await tableExists("public.widgets")).toBe(false);
  });

  it("with ALLOW_BREAKING, applies the batch and records the breaking migration's tag", async () => {
    await runMigrations(sql, { migrationsFolder: fixture("v2"), allowBreaking: true });

    expect(await widgetColumns()).toEqual(["id"]);
    expect(await recordedBreakingTag()).toBe("0001_drop_widget_name");
  });

  it("judges only pending migrations, and keeps the recorded tag across later additive ones", async () => {
    await runMigrations(sql, { migrationsFolder: fixture("v1"), allowBreaking: false });

    await expect(runMigrations(sql, { migrationsFolder: fixture("v2"), allowBreaking: false })).rejects.toThrow(
      /pending: 0001_drop_widget_name\./,
    );
    expect(await widgetColumns()).toEqual(["id", "name"]);

    await runMigrations(sql, { migrationsFolder: fixture("v2"), allowBreaking: true });
    await runMigrations(sql, { migrationsFolder: fixture("v3"), allowBreaking: false });

    expect(await tableExists("public.gadgets")).toBe(true);
    expect(await recordedBreakingTag()).toBe("0001_drop_widget_name");
  });

  it("records a breaking migration applied by another migrator, such as drizzle-kit", async () => {
    // drizzle-orm's migrator, which drizzle-kit shares: it ignores the marker.
    await migrate(drizzle(sql), { migrationsFolder: fixture("v2") });

    await runMigrations(sql, { migrationsFolder: fixture("v3"), allowBreaking: false });

    expect(await recordedBreakingTag()).toBe("0001_drop_widget_name");
  });

  it("leaves the schema unchanged when a migration fails part-way through the batch", async () => {
    await expect(runMigrations(sql, { migrationsFolder: fixture("failing"), allowBreaking: false })).rejects.toThrow(
      /no_such_table/,
    );

    expect(await tableExists("public.widgets")).toBe(false);
    expect(await tableExists("public.half_done")).toBe(false);
    expect(await tableExists("drizzle.__drizzle_migrations")).toBe(false);
  });
});
