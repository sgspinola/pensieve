# 09: Mutation logging — field-diff for item/flashcard updates

**What to build:** Every create/update/delete on items and flashcards logs the entity's kind and ID, success or failure. Update operations specifically (`updateItem`, `updateFlashcard`) additionally log which field *names* changed — not old/new values, to avoid logging potentially large or unvetted content — reusing the pre-update row both already fetch for permission/merge purposes, so no new query is needed.

**Blocked by:** 03 (Request correlation ID)

**Status:** done

**Completed:** on `feat/09-mutation-logging-item-flashcard-field-diff`

**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/7

- [x] `createItem`, `updateItem`, `deleteItem` log `entityKind: "items"` and `entityId` on both success and failure
- [x] `createFlashcard`/equivalent, `updateFlashcard`, delete-flashcard log `entityKind: "flashcards"` and `entityId` on both success and failure
- [x] `updateItem` additionally logs `changedFields`: the names of fields that differ between the pre-update read and the update payload
- [x] `updateFlashcard` additionally logs `changedFields` the same way
- [x] No old/new field values appear in any mutation log line, only field names
- [x] Vitest: register an in-memory LogTape test sink and assert on `entityKind`/`entityId`/`changedFields` for a representative item update and a representative flashcard update
