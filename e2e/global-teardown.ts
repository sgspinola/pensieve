import fs from "node:fs";
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { tags, users } from "../src/db/schema";
import { pruneUnusedTags } from "../src/services/tags/tags";
import { SEEDED_USER_FILE } from "./global-setup";

/**
 * Deletes the throwaway user global-setup.ts seeded — cascades to its
 * session and any items/flashcards created during the run (items.createdBy,
 * flashcards.createdBy, and sessions.userId all reference users.id with
 * onDelete: "cascade", see src/db/schema.ts), which in turn cascades to
 * itemTags/flashcardTags. The `tags` rows themselves have no FK to users, so
 * any tag that run created (e.g. "playwright-study-<timestamp>") would
 * otherwise linger forever once its last item/flashcard reference is gone —
 * a full pruneUnusedTags sweep over every tag id closes that gap. Safe as a
 * full sweep here since it only deletes tags with zero remaining references
 * and the e2e context has a small tag table.
 */
export default async function globalTeardown() {
  if (!fs.existsSync(SEEDED_USER_FILE)) return;
  const { userId } = JSON.parse(fs.readFileSync(SEEDED_USER_FILE, "utf-8")) as { userId: string };

  const db = getDb();
  await db.delete(users).where(eq(users.id, userId));

  const allTagIds = await db.select({ id: tags.id }).from(tags);
  await pruneUnusedTags(
    db,
    allTagIds.map((row) => row.id),
  );

  fs.rmSync(SEEDED_USER_FILE, { force: true });
}
