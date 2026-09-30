# 07: Redesign visual identity — "Technical Precision"

## Problem Statement

Pensieve's visual identity is a retro-pixel aesthetic: Press Start 2P for display text, Geist Mono for body, a single hardcoded dark navy/blue palette (`color-scheme: dark` fixed at root, no light mode), bracket-and-caps nav labels (`[LIBRARY]`, `[WIKI]`, `[FLASHCARDS]`, `[{name} ({role})]`), and a hand-drawn pixel-block SVG logo. There is no icon library — a few places use hand-typed `▾`/`▴` glyphs instead of real iconography. This was a deliberate look, but the user wants a full visual overhaul, not a refinement, while keeping the parts of the current setup that already work: CSS Modules everywhere (already ~100% consistent, no Tailwind/component library) and a monospace-leaning, developer-tool mood appropriate for this app's actual audience (a self-hosted, passkey-only personal knowledge base for a technical user).

## Solution

Adopt a new direction, **Technical Precision**, that evolves the developer-tool identity with a cleaner, more legible mono/sans type pairing instead of the pixel font, adds a real light mode alongside dark (with a toggle), introduces `lucide-react` for consistent iconography, moves destructive/danger states to red, drops the bracket-and-caps label convention for plain text, and redraws the logo mark to match the new, non-pixel visual language.

The direction was chosen after building a live side-by-side comparison (three candidate directions — Technical Precision, Clean Minimal/Swiss, Warm Editorial — each rendered in dark and light with real fonts, colors, and a sample card+button) and confirming with the user before committing.

### Design tokens

Token *names* in `src/app/globals.css` are unchanged; values move from a single `:root` block to theme-scoped blocks:

| Token | Dark | Light |
|---|---|---|
| `--color-bg` | `#0F172A` | `#F8FAFC` |
| `--color-bg-panel` | `#1B2336` | `#FFFFFF` |
| `--color-border` | `#475569` | `#E2E8F0` |
| `--color-text` | `#F8FAFC` | `#0F172A` |
| `--color-text-muted` | `#94A3B8` | `#475569` |
| `--color-accent` | `#22C55E` | `#16A34A` |
| `--color-accent-rgb` | `34, 197, 94` | `22, 163, 74` |
| `--color-accent-deep` | `#15803D` | `#166534` |
| `--color-danger` | `#EF4444` | `#DC2626` |
| `--color-danger-rgb` | `239, 68, 68` | `220, 38, 38` |

`--space-*` and `--carousel-duration` are theme-independent and unchanged. `--font-display` moves from Press Start 2P to JetBrains Mono; `--font-body` moves from Geist Mono to IBM Plex Sans (IBM Plex Sans is not a variable Google font — weights `400/500/600/700` must be enumerated explicitly in `next/font/google`).

## User Stories

1. As a user, I want the app's colors and type to look like a precise developer tool rather than a retro pixel-art game, so that it matches how I actually use it day to day.
2. As a user, I want a light mode option, so that I can use the app comfortably in bright environments, not just dark-only.
3. As a user, I want to toggle between light and dark from the account menu, so that switching themes doesn't require digging through settings.
4. As a user, I want my theme choice to persist across visits and page loads without a flash of the wrong theme, so that the app feels considered rather than glitchy.
5. As a user, I want destructive actions (delete item, delete flashcard, delete wiki page) to use a color that clearly reads as dangerous, so that I don't confuse them with the primary accent color.
6. As a user, I want consistent vector icons on actions, destructive buttons, empty states, and the theme toggle, so that the UI doesn't rely on hand-typed glyphs like `▾`.
7. As a user, I want nav tabs and account-menu labels in plain text instead of bracket-and-caps styling, so that the chrome reads cleaner alongside the new icon set.
8. As a user, I want the logo mark redrawn to match the new visual language, so that it doesn't look like a leftover from the old pixel-art identity.
9. As a user, I want every existing page (library, wiki, flashcards/study, login/invite, admin) to receive this redesign consistently, so that no part of the app feels visually mismatched.
10. As a developer, I want the token swap to cascade through the existing CSS Modules without needing per-component color edits, so that the redesign doesn't require touching all ~30 module files individually for color alone.
11. As a developer, I want Mermaid diagram theming and code-block syntax highlighting (`rehype-prism-plus`) explicitly re-themed for light mode, so that wiki articles with diagrams/code remain legible in both themes (these are not driven by the CSS custom-property cascade).
12. As a developer, I want a Playwright smoke spec proving the theme toggle flips `data-theme` and that the choice survives a reload, so that a regression in the persistence mechanism is caught.

## Implementation Decisions

- **Theme mechanism**: `data-theme="dark"|"light"` attribute on `<html>`, not a `prefers-color-scheme` media query (can't be manually overridden or read server-side). `src/app/layout.tsx` reads a `theme` cookie via `cookies()` (mirrors the existing pattern in `api/auth/*/route.ts`) and renders `<html data-theme={theme}>` — correct on the first server-rendered byte, no flash-of-wrong-theme. Default when no cookie exists: `dark` (matches current behavior). True first-visit `prefers-color-scheme` detection is explicitly out of scope — see Out of Scope.
- **Toggle placement**: new `ThemeToggle.tsx`, wired into `AccountMenu.tsx` (the existing home for user-level preferences — Import/Export, Logout already live there), using Lucide's `Sun`/`Moon`.
- **Persistence**: the toggle writes the `theme` cookie directly (`document.cookie`, non-httpOnly — a non-sensitive UI preference, not auth) and calls `router.refresh()` to re-render the server tree with the new attribute. No new API route.
- **Token layer**: restructure `src/app/globals.css` so theme-dependent tokens live under `[data-theme="dark"]` / `[data-theme="light"]` selectors; theme-independent tokens (fonts, spacing, motion) stay in `:root`. Every `*.module.css` file already consumes colors exclusively via `var(--color-*)` (confirmed — zero hardcoded hex outside `globals.css`, only legitimate `rgba(0,0,0,0.6)` modal-backdrop overlays), so this cascades to all ~30 module files with no per-file color edits. `items/markdown-theme.module.css` (the `@uiw/react-md-editor` variable remap) inherits the same way.
- **Fonts**: swap `Geist_Mono`/`Press_Start_2P` for `JetBrains_Mono`/`IBM_Plex_Sans` in `src/app/layout.tsx` (`next/font/google` API confirmed unchanged in Next.js 16 against `node_modules/next/dist/docs/`). Rename the generated CSS vars (`--font-geist-mono`→`--font-jetbrains-mono`, `--font-press-start`→`--font-plex-sans`) — nothing outside `layout.tsx`/`globals.css` references the raw names. `Wordmark.module.css` and ~10 other files referencing `--font-display` directly need spacing/size re-tuning, since those values were tuned for Press Start 2P's unusually wide glyphs.
- **Not covered by the token cascade** — must be located and re-themed explicitly: Mermaid diagram theming (wiki articles, `mermaid` devDep) and `rehype-prism-plus` code-block syntax highlighting both typically use their own imported theme config, not CSS custom properties.
- **Icons**: add `lucide-react` (new dependency; no icon library exists today). Rollout, scoped and concrete — primary nav stays text, not icon+label:
  - `▾`/`▴` → `ChevronDown`/`ChevronUp`: `AccountMenu.tsx`, `FlashcardRow.tsx`, `ItemRow.tsx`.
  - `AccountMenu.tsx` items: Invite (`UserPlus`), Import/Export (`ArrowLeftRight`), Log out (`LogOut`); `ImportExportModal.tsx` (`Download`/`Upload`).
  - Destructive actions (wiki delete confirm, item/flashcard delete): `Trash2`, paired with `--color-danger`.
  - Empty states (`ItemsLibrary.tsx`, `FlashcardsManager.tsx`, wiki empty-tree): one muted icon above existing copy (`Inbox`/`BookOpen`/`Layers`).
  - `Modal.tsx` close control → `X`.
  - Theme toggle → `Sun`/`Moon`.
- **Copy**: drop the bracket-and-caps convention. `Header.tsx`'s `NAV_TABS` labels (`[LIBRARY]` → `Library`, etc.) and `AccountMenu.tsx`'s trigger (`[{user.displayName} ({user.role})] ▾` → plain text + `ChevronDown`).
- **Logo**: redraw `LogoMark.tsx` as a simpler geometric/stroke mark in the Lucide visual language, replacing the pixel-block SVG. It already renders via `currentColor`, so it stays theme-agnostic automatically once redrawn. Check for a second consumer (e.g. `icon.svg`/favicon generation) and keep both in sync. `Wordmark.module.css` gets final size/spacing tuning once both the font and logo have landed.
- **Sequencing** (land in phases so the app is never half-styled at a committed point):
  1. Plumbing: restructure `globals.css` into `[data-theme]` blocks with dark values unchanged (pure mechanism, should be a visual no-op) + `layout.tsx` cookie read/attribute (hardcoded `dark`, no toggle UI yet).
  2. New dark palette: flip `[data-theme="dark"]` values to the new colors — one commit, visible everywhere via the cascade.
  3. Fonts: swap font imports, re-tune `Wordmark.module.css` and the other `--font-display` consumers in the same pass.
  4. Light theme: add `[data-theme="light"]` values, force it on temporarily and walk every route — surfaces what dark-only testing can't (Mermaid, Prism, modal backdrop contrast).
  5. Theme toggle UI: `ThemeToggle.tsx` + `AccountMenu.tsx` wiring + Playwright smoke spec.
  6. Icons: `npm install lucide-react`, roll out per the list above, one logical group per commit.
  7. Copy + logo: drop bracket labels, redraw `LogoMark.tsx`, final `Wordmark.module.css` tuning, full-app pass across both themes.

## Testing Decisions

- New `e2e/theme-toggle.spec.ts` (Playwright, follows the existing `global-setup.ts` seeded-session pattern): asserts the default `data-theme` value, that clicking the toggle flips the attribute and a computed-style spot check (e.g. background color) changes, and that reloading/navigating after a toggle preserves the choice (proves the cookie round-trip, not just the DOM mutation). Smoke-level only, per this repo's e2e convention.
- No new Vitest coverage — this is UI/CSS/Server-Component-cookie-read work, not service-layer logic, consistent with this repo's Vitest-is-service-layer-only convention.
- Manual verification across all primary routes (`/`, `/items/new`, `/flashcards`, `/flashcards/new`, `/flashcards/study`, `/wiki`, `/wiki/[id]`, `/login`, `/invite/[token]`, `/admin/invite`) in both themes, at each phase boundary above — not just once at the end.
- `graphify update .` after the structural changes land (new `ThemeToggle.tsx`, icon imports across files) — CSS-only commits won't move the graph much, so this matters most after the icon and toggle phases.

## Out of Scope

- True first-visit `prefers-color-scheme` detection — shipping "cookie present → use it; else dark" instead. Reading system preference server-side without a client round-trip isn't straightforward and would reintroduce a first-visit FOUC risk.
- Any change to routes, data model, or feature behavior — this is a visual/chrome-only pass.
- Redesigning primary navigation as icon+label — nav tabs stay text-first per the app's existing text/glyph-first identity; icons augment actions and status only.
- A full accessibility audit beyond what's already in place (existing `role`/`aria-*` usage is preserved, not re-audited, except where a new interactive element — the theme toggle — needs its own labeling).
- Documenting the theme toggle as a `docs/flows/` sequence diagram — it's global chrome/preference state, not a data-model flow; a brief addition to `docs/architecture/` is more appropriate if the user wants it documented at all.

## Further Notes

This spec was reached via an interactive design session: an initial codebase survey (current styling architecture, product type, audience), a design-system search comparing candidate style directions, a rendered visual comparison artifact for the three finalist directions (dark + light, real fonts/colors, a sample card+button), and a final round of targeted questions closing out the remaining open calls (danger color, bracket-label convention, logo redraw) — not assumptions. The full sequencing/verification detail above reflects a Plan-agent pass grounded in direct reads of `globals.css`, `layout.tsx`, `Wordmark.module.css`, `AccountMenu.tsx`, and `Header.tsx`.
