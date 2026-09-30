# 06: Collapse import/export modal into a single view

## Problem Statement

The Import/Export modal (opened from the account menu) makes users click through a multi-step wizard — choose a content type, then choose Import or Export, then (for Import) a further inline sub-flow — to do what is fundamentally one simple decision: pick a kind of content, then either import or export it. The step screens (with Back buttons) add navigation overhead for an action that has very little actual complexity underneath it, and the "download a sample file" step requires a full file-system round trip just to see what the expected format looks like.

## Solution

Replace the multi-step wizard with a single, always-rendered view inside the same modal shell:

- One type select (Flashcards / Links / Tools / Articles), starting on an explicit "Select a kind…" placeholder.
- Import and Export controls are both visible at once (no more separate "choose action" step) — a file-selection control plus an Import button, and an Export button/link — all disabled until a type is chosen.
- A sample area, shown immediately regardless of type selection, with one tab per kind, rendering the sample content as a copyable code snippet instead of a downloadable file. This tab strip is independent of the main type select — browsing a sample tab never changes what's about to be imported or exported.

No step navigation, no Back button, no screen transitions — everything needed is visible in one view, with disabled affordances signaling what to do first.

## User Stories

1. As a user, I want to open Import/Export and see the whole flow in one view, so that I don't have to click through steps to get to the action I want.
2. As a user, I want the type select to start unselected with a clear placeholder, so that it's obvious I need to make a choice before anything else works.
3. As a user, I want the Import button, Export button, and file-selection control to be visible (but disabled) before I pick a type, so that the layout doesn't shift or pop controls in and out as I use it.
4. As a user, I want the Import button, Export button, and file-selection control to become enabled the moment I pick a type, so that I can immediately act on my choice.
5. As a user, I want to see an example of the expected import format as a copyable snippet, so that I don't have to download a file just to see what my data should look like.
6. As a user, I want the sample snippet area to have a tab per content kind, so that I can check the format for any kind without committing to that kind as my active selection.
7. As a user, I want switching sample tabs to never change the main type select, so that comparing formats doesn't accidentally alter what I'm about to import or export.
8. As a user, I want a one-click "copy" affordance on the sample snippet, so that I can paste it straight into a new file without manual selection.
9. As a user, I want the sample area visible as soon as the modal opens, so that I can look at the expected format before deciding what to do.
10. As a user, I want to pick a file via the file-selection control and have it staged (not immediately imported), so that I get a chance to confirm before anything is committed.
11. As a user, I want to see how many entries were parsed from my staged file before I confirm, so that I can sanity-check it before committing.
12. As a user, I want a distinct "Import" click to commit the staged file, so that selecting a file doesn't accidentally trigger an import.
13. As a user, I want to see inline feedback while my file is being parsed and while the import is being committed, so that I know the operation is in progress.
14. As a user, I want a clear inline error message if parsing or committing fails, so that I understand what went wrong without losing my place in the flow.
15. As a user, I want a clear inline success summary after a successful import, so that I know it worked and roughly what happened (e.g. how many records were created/updated).
16. As a user, I want to click Export and get a direct download of all items of the selected kind, so that exporting stays a single click, same as today.
17. As a user, I want this to work identically for all four kinds (Flashcards, Links, Tools, Articles), so that the simplification isn't kind-specific.
18. As a developer, I want the existing e2e coverage for this modal to keep proving the flow renders and hydrates correctly, so that a regression here (e.g. a missing "use client") is still caught.
19. As a developer, I want the existing service-layer tests for import/export parsing, sample generation, and commit logic to remain valid, so that this is understood as a pure UI restructuring with no backend behavior change.

## Implementation Decisions

- **Modal shell unchanged**: continue rendering inside the existing `Modal.tsx` (`<dialog>`-based, focus trap, Esc-to-close). Only the content of `ImportExportModal.tsx` changes.
- **State model**: `ImportExportModal.tsx` drops its `action` step state entirely (no more `contentType === null` / `action === null` step gating for rendering). It keeps `contentType` (now driving enable/disable of the Import/Export/file-selection controls) and gains a separate, independent `activeSampleTab` state (defaulting to the first kind) that is never written to or read from `contentType`.
- **Import sub-flow retained**: `ImportFlow.tsx`'s existing `Stage` state machine (`idle`/`parsing`/`error`/`ready`/`importing`/`done`) is preserved as-is and continues to drive the inline parsing/error/ready-count/importing/done feedback. It's simply no longer gated behind a separate "Import" step screen — it renders directly in the always-visible Import section once a type is selected. `ItemImportFlow.tsx` / `FlashcardImportFlow.tsx` wrappers keep their current interface.
- **Disabled-until-selected**: Import button, Export button, and the file `<input type="file">` are rendered from the start and disabled via the standard `disabled` attribute (not conditionally unmounted) until `contentType` is set.
- **Sample snippet, new component**: introduce a small new component (e.g. `SampleSnippet.tsx` + `.module.css`) responsible for: tab strip over the four kinds, fetching/holding each kind's sample text, rendering it in a `<pre><code>` block, and a copy button using `navigator.clipboard.writeText` with a brief "Copied" affordance. No existing copy-to-clipboard pattern exists in the codebase (confirmed via grep and graphify query) — this is new.
- **Sample content source unchanged**: reuse the existing sample-generation endpoints as-is (`/api/items/import/sample?kind=`, `/api/flashcards/import/sample`) and their underlying service functions (`buildItemImportSample`, flashcard equivalent) — no backend changes. The only client-side change is consuming the response as `fetch().then(r => r.text())` for display/copy instead of navigating to it via `<a download>`. All four kinds' samples can be prefetched on mount since each is only two entries.
- **"Download sample" removed**: the `<a href={sampleHref} download>` link in `ImportFlow.tsx` is removed entirely, replaced by the new `SampleSnippet` component. No dual copy+download option.
- **Export unchanged**: keep the existing `<a download>` export link and `/api/items/export`, `/api/flashcards/export` routes exactly as they are (single-click, all items of the kind, no filters/format options) — only its position in the layout changes (always visible, not behind an action step).
- **Styling**: CSS Modules only, consistent with the rest of the codebase (`ImportExportModal.module.css` extended; new `SampleSnippet.module.css`). No inline styles.
- **No schema or API contract changes.**

## Testing Decisions

- Single test seam: the existing `e2e/import-export.spec.ts` Playwright spec, rewritten in place — this is the repo's established convention (per the root `CLAUDE.md`) for proving a component actually renders/hydrates, and it already covers this exact modal.
- Keep it smoke-level, per the repo's e2e convention: assert the modal opens without a page navigation; the type select starts on its placeholder with Import/Export/file-selection disabled; selecting each of the four kinds enables those controls; the sample tab strip is present and switching tabs doesn't change the type select's value; the Export control is a working download link/action for a selected kind; and the Import path (select a file → staged/ready state → click Import → success state) completes without a client-side error, for at least one kind.
- Do not assert on exact created/updated counts, parsed entry contents, or exact sample text in the e2e spec — that's the job of the existing service-layer Vitest tests (`items-import.test.ts`, `items-export.test.ts`, `flashcards-import.test.ts`, `flashcards-export.test.ts`), which are untouched by this change and remain the source of truth for that behavior.
- No new Vitest tests are needed for the `SampleSnippet` component's fetch/copy behavior beyond what the e2e smoke coverage exercises, since it has no business logic of its own (it displays text a backend endpoint already generates and already has service-layer test coverage for).

## Out of Scope

- Any change to what gets imported/exported, validation rules, or the sample content itself (still two curated example entries per kind).
- Column mapping, per-field preview, or any richer import preview than the existing entry-count "ready" state.
- Export options (format choice, filtering, column selection) — export remains a single "everything of this kind" download.
- Adding Wiki pages as an importable/exportable kind (explicitly excluded today and unaffected by this change).
- Any change to how the modal is triggered (`AccountMenu.tsx`'s "Import / Export" item is unchanged).
- Accessibility audit beyond preserving existing roles/labels (`role="alert"` for errors, dialog semantics, etc.) already in place.

## Further Notes

This spec was reached via an interview-style design session (`/grill-me`) rather than an initial written request; the decisions above reflect explicit user answers, not assumptions — notably: the type select governs Import/Export/file-selection, while the sample tab strip is a deliberately independent, always-visible reference widget that never drives the active selection.
