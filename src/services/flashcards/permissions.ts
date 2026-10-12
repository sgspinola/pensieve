import type { SessionUser } from "@/services/auth/session";

/**
 * Pure predicate for delete eligibility: the admin may delete any
 * flashcard, a member may delete only their own — the same rule
 * items.ts's canModifyItem uses. (Originally creator-only with no admin
 * case at all; that asymmetry had no recorded rationale and was reversed.)
 * Used by both deleteFlashcard's own check and client UI that decides
 * whether to render a delete control at all.
 *
 * Ticket 26: in its own I/O-free module, not `flashcards.ts`, for the same reason as
 * `pagination.ts`: the "use client" FlashcardRow imports it, and pulling in
 * `flashcards.ts` would drag the logging/mutation-log/DB stack (and
 * `node:async_hooks`) into the browser bundle, which breaks `next build`.
 * Only a type is imported from the session service, so nothing server-side
 * reaches the client.
 */
export function canDeleteFlashcard(actor: SessionUser, flashcard: { createdBy: string }): boolean {
  return actor.role === "admin" || actor.id === flashcard.createdBy;
}
