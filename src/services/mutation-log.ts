import "server-only";
import type { Logger } from "@logtape/logtape";

import type { CreatableItemKind } from "@/services/items/item-kinds";

/**
 * Shared helper for ticket 09's mutation logging: given a row fetched before
 * an update and the (partial) update payload that's about to be applied,
 * returns the *names* of the fields that actually differ — never the old or
 * new values themselves, since those may be large or unvetted content that
 * has no business ending up in a log line. Only the fields present as keys
 * on `updates` are compared; a field the payload never touches can't have
 * "changed" by definition, so it's never diffed.
 *
 * Shared between items.ts and flashcards.ts (both already fetch the
 * pre-update row for permission/merge purposes, so this reuses that fetch
 * rather than requiring a new query) so the field-diff rule can't drift
 * between the two call sites.
 */
export function changedFieldNames<T extends Record<string, unknown>>(before: T, updates: Partial<T>): string[] {
  return (Object.keys(updates) as (keyof T)[]).filter((key) => before[key] !== updates[key]).map((key) => String(key));
}

/** Fields common to every mutation log line — entity identity and, for updates, which field names changed. */
export interface MutationLogFields {
  entity:
    | "items"
    | "flashcards"
    | "tags"
    | "invites"
    | "sessions"
    | "recoveryCodes"
    | "webauthnCredentials"
    | "webauthnUsers";
  // The item's own `kind` column — only set for `entity: "items"`, and only
  // when the item's kind is known (e.g. not for an update of a missing item).
  kind?: CreatableItemKind;
  // Omitted only for a create that fails before its row exists — see
  // logMutationFailure's docstring.
  entityId?: string;
  changedFields?: string[];
}

/**
 * Logs a successful create/update/delete on an item or flashcard.
 * `entity`/`entityId` (plus `kind` for items, and `changedFields` for updates) are the ticket
 * 09 mutation-logging contract — nothing else goes in `fields`, so no old/new
 * field value can accidentally ride along.
 */
export function logMutationSuccess(logger: Logger, message: string, fields: MutationLogFields): void {
  logger.info(message, { ...fields });
}

/**
 * Logs a failed create/update/delete on an item or flashcard, alongside the
 * thrown error's message (never the raw error object or the mutation
 * payload/row, which could carry unvetted field values). `entityId` is
 * omitted only for a create failure that happened before any row was
 * inserted — there's no id yet to log in that case.
 */
export function logMutationFailure(logger: Logger, message: string, fields: MutationLogFields, error: unknown): void {
  logger.error(message, { ...fields, error: error instanceof Error ? error.message : String(error) });
}
