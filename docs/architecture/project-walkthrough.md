# Project walkthrough

This page is an entry point for readers with **no prior Next.js background**.
If you already know the App Router, skip to
**[Rendering strategy](#rendering-strategy-ssr-csr-and-static)** below, or go
straight to the request-by-request technical detail in
**[System overview](/architecture/system-overview)**.

## What Next.js's App Router is

Next.js is a framework that serves both the frontend (pages a browser
renders) and the backend (API endpoints) from one codebase, using **file
paths as routing** instead of a router configured in code. Where a file
lives under `src/app/` determines its URL. This repo uses the App Router
(the current convention — the older "Pages Router" isn't used here) on
**Next.js 16**, which changed a few conventions from what most tutorials
assume — see the note on `proxy.ts` below.

Two filenames inside `src/app/` are special:

- **`page.tsx`** — a page a browser visits. A folder named `[id]` (e.g.
  `src/app/wiki/[id]/`) is a URL parameter.
- **`route.ts`** — an API endpoint, not a page. It exports functions named
  after HTTP verbs (`GET`, `POST`, `PATCH`, `DELETE`).

`src/app/items/` (the page) and `src/app/api/items/` (the endpoint) are a
matched pair, colocated by feature — there's no separate top-level
"frontend"/"backend" split, and no separate backend service: it's one
process.

## Repository layout

```
src/app/       → pages and API routes (routing lives here)
src/services/  → business logic — the only code allowed to import drizzle-orm
src/db/        → schema (src/db/schema.ts) + connection (src/db/client.ts)
src/lib/       → shared helpers: auth cookies, error mapping, request parsing
src/test/      → Vitest database harness (real disposable Postgres per run)
e2e/           → Playwright browser tests
docs/          → this VitePress site
drizzle/       → generated SQL migrations
```

The README states the rule the rest of this page assumes throughout: **all
business logic lives in `src/services/`, never directly in a route file.**
Route handlers stay thin (parse → call one service function → map errors).

## The auth gate: `src/proxy.ts`

Every request — page or API — passes through `src/proxy.ts` first. This is
Next 16's replacement for the older `middleware.ts` convention (the name
changed; the "runs before everything" role didn't). It reads the `session`
cookie, looks up the session in Postgres, and on success stamps a trusted
`x-pensieve-user` header that every downstream page/route reads instead of
re-querying the database. Full detail, including the failure paths, is on
[System overview](/architecture/system-overview#the-auth-gate-in-detail).

## Features at a glance

- **Items** (`src/services/items/`, root page `src/app/page.tsx`) — saved
  links/tools/articles, with metadata autofetch and import/export. See
  [Item lifecycle](/flows/item-lifecycle).
- **Flashcards** (`src/services/flashcards/`, `src/app/flashcards/`) —
  spaced-repetition study cards. See
  [Flashcard study session](/flows/flashcard-study-session).
- **Wiki** (`src/app/wiki/`) — hierarchical, self-authored pages; these are
  `items` with `kind: "page"`. See
  [Wiki article management](/flows/wiki-article-management).

Items and flashcards are structurally parallel but only loosely coupled —
see [Module structure](/architecture/module-structure) for how graphify's
own clustering confirms this.

## Running it locally

```bash
docker compose up -d --wait   # Postgres
cp .env.example .env && npm install
npm run db:migrate
npm run dev                    # → http://localhost:3000
```

First passkey registration on an empty database becomes the sole admin
account — see [Register with an invite](/flows/register-with-invite) and
[Login with a passkey](/flows/login-with-passkey).

## Rendering strategy: SSR, CSR, and static

Next.js can render a given piece of UI three different ways, and this app
uses two of them deliberately and avoids the third:

| Strategy | What it means | Used here? |
|---|---|---|
| **SSR** (server-side rendering) | HTML is built fresh on the server for every request | Yes — every page |
| **CSR** (client-side rendering) | JavaScript that runs in the browser and updates the DOM after load | Yes — narrowly, inside specific interactive components |
| **Static rendering / ISR** | HTML built once (at build time or on a timer) and reused across requests | **No** — not used anywhere in this app |

### Every page is a Server Component, rendered dynamically per request

None of the 10 `page.tsx` files under `src/app/` contain a `"use client"`
directive — every page (`/`, `/items/new`, `/flashcards`, `/flashcards/new`,
`/flashcards/study`, `/wiki`, `/wiki/[id]`, `/login`, `/invite/[token]`,
`/admin/invite`) is a **Server Component**: its code runs only on the
server, and it can call service functions (`listItems()`, `listFlashcards()`,
etc.) directly — no `fetch`, no API round trip, just a function call that
returns already-authorized, already-queried data as props.

Crucially, this is **SSR, not static rendering**. Two things force every
request through the server at request time rather than serving a
pre-built/cached page:

- `RootLayout` (`src/app/layout.tsx:27`) calls `(await cookies()).get("theme")`
  to decide `<html data-theme>` — reading the incoming request's cookies is
  a "dynamic API" in Next's terms, and using one anywhere in the component
  tree opts the whole render out of static generation.
- Every authenticated page calls `requireCurrentUser()`
  (`src/lib/current-user.ts:11`), which calls `headers()` — also a dynamic
  API, for the same reason.

`next.config.ts` sets no `output: "export"`, no `generateStaticParams`, no
`revalidate`, and no `force-static` appears anywhere under `src/app/`
(confirmed by grep) — so there is no static HTML and no incremental
regeneration anywhere in this app. Every response is generated fresh,
per-request, on the server.

### Client Components are opt-in, and used narrowly

31 components carry a `"use client"` directive — the App Router default is
server rendering, and a component must explicitly opt into running (and
re-running) in the browser. They fall into a few clear categories:

- **Forms and inputs** — `ItemForm.tsx`, `FlashcardForm.tsx`, `LoginForm.tsx`,
  `InviteForm.tsx`, `TagsInput.tsx`, `TagFilterInput.tsx`,
  `MarkdownEditor.tsx`.
- **Interactive chrome** — `Header.tsx`, `AccountMenu.tsx`, `Modal.tsx`,
  `ThemeToggle.tsx`, `TagCloud.tsx`.
- **Feature-specific interaction** — `ItemsLibrary.tsx` (list + infinite
  scroll), `ItemRow.tsx`, `ParentArticleSelect.tsx`, `FlashcardsManager.tsx`,
  `FlashcardRow.tsx`, `study/StudySession.tsx`, `study/Flashcard.tsx`,
  `WikiShell.tsx`, `WikiSidebar.tsx`, `ArticleView.tsx`.
- **Import/export flows** — `ImportExportModal.tsx`, `ImportFlow.tsx`,
  `ItemImportFlow.tsx`, `FlashcardImportFlow.tsx`, `RecoveryCodesDisplay.tsx`,
  `GenerateInviteButton.tsx`.

A Client Component still gets its *first* render from the server (Next
server-renders the initial HTML for these too, then "hydrates" it in the
browser) — `"use client"` means "this can re-render and hold state in the
browser afterward," not "this skips SSR entirely."

### The hybrid pattern: SSR for the first page, CSR for what happens next

`ItemsLibrary.tsx` and `FlashcardsManager.tsx` are the clearest example of
how SSR and CSR combine here:

1. The Server Component page (`src/app/page.tsx`) calls `listItems()`
   directly and passes the first page of results in as props — this part is
   pure SSR, no API route involved.
2. As the user scrolls, `ItemsLibrary.tsx:153` calls
   `fetch(\`/api/items?...\`)` from the browser to page in more results —
   this part is CSR, and it's the one place the API route layer exists for
   *reading* data.
3. After a mutation (create/edit/delete), the client calls
   `router.refresh()` (`ItemsLibrary.tsx:267`, `ItemForm.tsx:283`/`:289`)
   rather than re-fetching from an API route — this re-runs the *Server*
   Component on the server and streams fresh HTML down, so the "reload" is
   SSR again, not a client-side cache patch.

A few other Client Components fetch from API routes for narrow,
browser-only needs: `ItemForm.tsx:214` (`/api/items/metadata`, autofetching
a link's title as you type) and `ItemRow.tsx:262` /
`ParentArticleSelect.tsx:45` (`/api/items?kind=page`, populating a parent-
article picker). Actual mutations (`POST`/`PATCH`/`DELETE`) always go
through the API routes, since the browser has no way to call a server-only
service function directly.

### What the API routes are — and aren't — for

Given the above, `src/app/api/**/route.ts` exists specifically for what
only the browser can trigger: pagination, in-form lookups, and mutations.
It is **not** part of how a page's initial content, or a full-page refresh,
gets rendered — that path always goes Server Component → service function
directly, with no HTTP hop. See
[System overview](/architecture/system-overview#routes--services--drizzle--postgres)
for the route → service → Drizzle → Postgres chain those routes do sit in.

### Aside: this docs site is static, the app is not

Unrelated to the app itself: `docs/` is a separate VitePress project, and
`npm run docs:build` produces a fully static site (plain HTML/CSS/JS, no
server, no per-request rendering) — the opposite rendering strategy from
the SSR-only app it documents. `npm run docs:dev` runs a local dev server
for editing; the static build is what actually gets deployed.
