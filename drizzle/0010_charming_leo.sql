-- Ticket 03 (batch-import-export-and-article-item-type): run
-- scripts/backfill-item-titles.ts first for a readable, URL-derived title on
-- any pre-existing null-title row. This UPDATE is a safety net only, not a
-- substitute for that script — it guarantees this migration itself can
-- never fail (and never leaves a genuinely NULL title behind) even if that
-- step was skipped, at the cost of a generic placeholder for whatever it
-- catches instead of a derived one.
UPDATE "items" SET "title" = 'Untitled' WHERE "title" IS NULL;
--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "title" SET NOT NULL;
