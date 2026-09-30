import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Throwaway table used only to prove the test harness end-to-end (per
// issue 01). Real domain tables arrive with their own tickets.
export const pings = pgTable("pings", {
  id: serial("id").primaryKey(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// A plain text column with a TS-level enum, not a native Postgres enum type:
// native enum types are created in a fixed schema (not the connection's
// search_path), which collides across the disposable per-test-run schemas
// the test harness creates (see src/test/db.ts).
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  () => [
    // DB-enforced "at most one admin" — closes the race where two concurrent
    // bootstrap registrations (both seeing an empty `users` table) would
    // otherwise both insert an admin row.
    uniqueIndex("users_single_admin")
      .on(sql`(true)`)
      .where(sql`role = 'admin'`),
  ],
);

// One row per registered passkey credential (a user may hold several, one
// per device), per SimpleWebAuthn's storage requirements.
export const webauthnCredentials = pgTable("webauthn_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Base64url-encoded WebAuthn credential ID, unique per credential.
  credentialId: text("credential_id").notNull().unique(),
  // Base64url-encoded CBOR COSE public key.
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull().default(0),
  transports: text("transports").array(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Session tokens are random values handed to the browser as an httpOnly
// cookie; only their SHA-256 hash (this row's id) is stored, so a stolen DB
// dump can't be replayed as a live session.
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One-time account-recovery codes, issued in a batch when a user registers a
// passkey. Only the SHA-256 hash of each code is stored (same rationale as
// `sessions`); `usedAt` is set atomically on redemption so a code can never
// be redeemed twice.
export const recoveryCodes = pgTable("recovery_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull().unique(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Unified table for every saved thing in the workspace: links, tools,
// "saved to read" articles, and self-authored wiki pages. `kind`
// distinguishes them but every column is shared — tools deliberately get no
// bespoke fields. `page` is the wiki kind (using `content` as its markdown
// body); it held the stored value `"article"` before the batch-import-export
// ticket 02 migration renamed it to free up `"article"` for the new,
// Link-shaped "saved to read" kind. Same as `users.role` above: a plain text
// column with a TS-level enum, not a native Postgres enum type, for the same
// per-test-database schema reason.
export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind", { enum: ["link", "tool", "article", "page"] }).notNull(),
  // Self-reference for the wiki hierarchy: a page's parent page.
  // Nullable for top-level pages and for every link/tool/article. No
  // `onDelete` action here on purpose — delete-time re-parenting/cascade is
  // handled explicitly in application code (see ticket 04), not via a
  // DB-level FK action.
  parentId: uuid("parent_id").references((): AnyPgColumn => items.id),
  // Absent for wiki pages, which have no source URL to fetch metadata from.
  url: text("url"),
  // Auto-fetched from the URL's OG/title/meta-description tags for
  // links/tools/articles (see fetchUrlMetadata), authored directly for
  // wiki pages; either way the user can freely override what ends up here.
  // NOT NULL as of ticket 03 (batch-import-export-and-article-item-type):
  // createItem itself now rejects a request that would otherwise resolve to
  // an empty/null title (including a failed/empty metadata fetch); a one-off
  // backfill script (since removed) filled pre-existing rows before this
  // constraint was added.
  title: text("title").notNull(),
  description: text("description"),
  // Wiki page markdown body; unused for link/tool/article items.
  content: text("content"),
  // Shared freeform markdown note, used by every kind.
  notes: text("notes"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// A freeform tag, shared workspace-wide across every item kind. `name` is
// stored already normalized (trimmed, internal whitespace collapsed, lower-
// cased — see normalizeTagName in src/services/tags/tags.ts) so the unique
// constraint itself enforces case/whitespace-insensitive reuse: two attempts
// to create "Machine Learning" and "machine  learning" collide on the same
// row rather than producing near-duplicates.
export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Many-to-many join between items and tags (issue 07) — a normalized
// relation rather than a text array/column on `items`, so autocomplete and
// any future tag-management feature have a clean, indexed home instead of
// scanning/parsing array columns.
export const itemTags = pgTable(
  "item_tags",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.tagId] })],
);

// A standalone front/back study prompt (flashcards feature), sibling to
// `items` but deliberately its own table rather than a squeezed-in `items`
// row: none of `items`' fields (kind, parentId, url, description, notes)
// apply to a simple recall pair.
export const flashcards = pgTable("flashcards", {
  id: uuid("id").primaryKey().defaultRandom(),
  front: text("front").notNull(),
  back: text("back").notNull(),
  // SHA-256 hex digest of the trimmed `front` text (ticket 04) — gives
  // import upsert a real indexed match instead of an in-memory scan, and
  // incidentally makes two cards with the exact same question impossible.
  frontHash: text("front_hash").notNull().unique(),
  // Free-form citation text (ticket 04), shown alongside the answer during
  // study instead of being inlined into `back`.
  source: text("source").notNull(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Many-to-many join between flashcards and the *same* shared `tags` table
// `itemTags` references — structurally identical to `itemTags` — so the tag
// pool (and its autocomplete/pruning logic) is shared across both content
// types rather than duplicated.
export const flashcardTags = pgTable(
  "flashcard_tags",
  {
    flashcardId: uuid("flashcard_id")
      .notNull()
      .references(() => flashcards.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.flashcardId, table.tagId] })],
);

// A one-time invite link token generated by the admin and shared out of
// band (Signal, in person, etc. — no email-sending capability, see spec).
// Only the SHA-256 hash of the token is stored (same rationale as
// `sessions`/`recovery_codes`); `usedAt` is set atomically on redemption so
// a link can never be redeemed twice, and `usedBy` records the member
// account it created.
export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedBy: uuid("used_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
