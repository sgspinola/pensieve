import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/services/auth/session";
import { canDeleteFlashcard } from "@/services/flashcards/permissions";

describe("canDeleteFlashcard", () => {
  it("returns true for the creator and for any admin, false for a non-creator, non-admin member", () => {
    const alice: SessionUser = { id: "alice-id", displayName: "Alice", role: "member" };
    const admin: SessionUser = { id: "admin-id", displayName: "Admin", role: "admin" };
    const bob: SessionUser = { id: "bob-id", displayName: "Bob", role: "member" };
    const flashcard = { createdBy: "alice-id" };

    expect(canDeleteFlashcard(alice, flashcard)).toBe(true);
    expect(canDeleteFlashcard(admin, flashcard)).toBe(true);
    expect(canDeleteFlashcard(bob, flashcard)).toBe(false);
  });
});
