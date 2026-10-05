import { randomUUID } from "node:crypto";
import path from "node:path";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { getDatabaseUrl } from "@/db/env";
import * as schema from "@/db/schema";

export type TestDatabase = PostgresJsDatabase<typeof schema>;

/**
 * Creates an isolated, throwaway Postgres database for a single test run,
 * migrates it to the current schema, and returns a scoped drizzle client plus
 * a teardown function that drops the database and closes the connection.
 *
 * A full database-per-run (rather than a schema-per-run within one shared
 * database) is used deliberately: drizzle-kit hardcodes the `public` schema
 * in generated foreign key references (e.g. `references "public"."users"`),
 * so a schema-scoped connection's inserts would satisfy that FK check against
 * the wrong (shared) `public.users` table. A fresh database's own `public`
 * schema is exactly what unqualified migration SQL targets, so this sidesteps
 * that mismatch entirely.
 *
 * The one place besides src/db/connection.ts that opens connections itself:
 * it needs a superuser `DATABASE_URL` it can rewrite to point at each
 * throwaway database, which tests always have (they never use IAM auth).
 */
export async function createTestDb(): Promise<{
  db: TestDatabase;
  teardown: () => Promise<void>;
}> {
  const adminConnectionString = getDatabaseUrl();
  const dbName = `test_${randomUUID().replace(/-/g, "")}`;

  const adminSql = postgres(adminConnectionString, { max: 1 });
  try {
    await adminSql.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await adminSql.end();
  }

  const sql = postgres(withDatabaseName(adminConnectionString, dbName), {
    max: 1,
  });

  try {
    const db = drizzle(sql, { schema });
    await migrate(db, {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });

    const teardown = async () => {
      await sql.end();
      await dropDatabase(adminConnectionString, dbName);
    };

    return { db, teardown };
  } catch (err) {
    await sql.end();
    await dropDatabase(adminConnectionString, dbName);
    throw err;
  }
}

function withDatabaseName(connectionString: string, dbName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${dbName}`;
  return url.toString();
}

async function dropDatabase(adminConnectionString: string, dbName: string) {
  const adminSql = postgres(adminConnectionString, { max: 1 });
  try {
    await adminSql.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  } finally {
    await adminSql.end();
  }
}
