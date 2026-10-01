import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDatabaseUrl } from "./env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

let sql: postgres.Sql | undefined;
let db: Database | undefined;

// Lazily connects so importing this module (e.g. from a service function
// under test) never opens a connection until the app/test actually needs one.
export function getDb(): Database {
  if (!db) {
    sql = postgres(getDatabaseUrl());
    db = drizzle(sql, { schema });
  }
  return db;
}
