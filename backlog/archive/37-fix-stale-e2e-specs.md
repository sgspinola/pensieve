# 37: Fix the five stale e2e specs

**What to build:** Five Playwright specs fail on `develop`, the same way against `next dev` and against the production image (found while verifying ticket 29). None is an app crash. Each spec encodes a UI detail that has since changed, so the suite can't yet act as the CI gate ticket 35 makes it. Fix the specs to assert the behaviour they were written to protect, without loosening them into tautologies:

- `wiki.spec.ts` ×3 ("can create a wiki page…", "'+ New page' opens the form in the content pane…", "deleting a page refreshes…") click an "Add item" button. The wiki creation form's primary submit is labelled "Add page" (`ItemForm.tsx`: `isPage ? "Add page" : "Add item"`).
- `items.spec.ts` "tag cloud and kind chip row filter items…" creates an item it treats as a Link, then expects deselecting the Link chip to hide it. `ItemForm`'s `defaultKind` is `"tool"`, so the item is a Tool and stays visible. The shared `addLinkWithTag` helper makes the same assumption.
- `flashcards-study.spec.ts` "study session: select a tag, flip a card…" asserts [PREVIOUS]/[FLIP]/[NEXT] share a row by comparing their *top* edges. [FLIP] stacks a keyboard-hint icon under its label, so it's taller, and centred in the row its top sits ~9px higher. The comment states the intent is "same row … rather than via a specific pixel offset", which means comparing vertical centres.

**Blocked by:** None (can start immediately)

**Status:** done

**Completed:** on `feat/37-fix-stale-e2e-specs`

**Pull Request:** PR_URL_PLACEHOLDER

- [x] Wiki specs submit via "Add page"; their comments name the right button
- [x] The kind-chip spec and `addLinkWithTag` explicitly select the Link kind instead of relying on the form's default
- [x] The study-session row check compares vertical centres
- [x] Found while fixing: `addFlashcard` confirmed a new card on the unfiltered `/flashcards` list (newest 30), which `import-export.spec.ts`'s parallel bulk import for the same shared user can crowd out. It now confirms under the card's run-unique tag
- [x] Full Playwright suite passes against `next dev`
- [x] Full Playwright suite passes against the production image (`PLAYWRIGHT_BASE_URL`, per the README)
