-- Ticket 04 (batch-import-export-and-article-item-type): run
-- scripts/backfill-flashcard-source-and-hash.ts first against any database
-- with pre-existing rows (a fresh/test database has none and needs no
-- backfill). Unlike items.title's NOT NULL migration (drizzle/0010_*.sql),
-- this one has no cheap, harmless generic safety-net fallback: frontHash
-- must be the real SHA-256 of `front` (a different algorithm here — e.g.
-- Postgres's built-in md5() — would silently break ticket 06's import
-- upsert matching for whichever rows got the substitute value instead of
-- just failing loudly), so this migration fails outright on any remaining
-- null row rather than papering over it.
ALTER TABLE "flashcards" ALTER COLUMN "front_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "flashcards" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_front_hash_unique" UNIQUE("front_hash");
