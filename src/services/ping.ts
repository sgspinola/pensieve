import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { pings } from "@/db/schema";

export async function createPing(db: Database, message: string) {
  const [row] = await db.insert(pings).values({ message }).returning();
  return row;
}

export async function getPing(db: Database, id: number) {
  const [row] = await db.select().from(pings).where(eq(pings.id, id));
  return row ?? null;
}
