-- Ticket 02 (batch-import-export-and-article-item-type): the wiki item kind
-- moves from "article" to "page", freeing up "article" for the new,
-- Link-shaped "saved to read" kind. `kind` is a plain text column (see
-- schema.ts), so this is a pure data backfill — no DDL/type change needed.
UPDATE items SET kind = 'page' WHERE kind = 'article';
