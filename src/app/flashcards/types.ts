import type { FlashcardWithCreator } from "@/services/flashcards/flashcards";

/**
 * `FlashcardWithCreator` as it travels to the client: timestamps become ISO
 * strings (Date instances aren't guaranteed serializable across the
 * server/client boundary), everything else is unchanged. Mirrors
 * `SerializedItem`/`serializeItem` in `@/app/items/types.ts`.
 */
export type SerializedFlashcard = Omit<FlashcardWithCreator, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

export function serializeFlashcard(flashcard: FlashcardWithCreator): SerializedFlashcard {
  return {
    ...flashcard,
    createdAt: flashcard.createdAt.toISOString(),
    updatedAt: flashcard.updatedAt.toISOString(),
  };
}
