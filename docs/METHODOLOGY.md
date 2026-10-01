# How these docs were produced

This is a maintainer reference, not a docs page — it isn't in the site's
nav or sidebar and isn't linked from any page under `docs/architecture/` or
`docs/flows/`. It exists so that whoever regenerates a page later (human or
agent) knows which tool produced it, what that tool was good and bad at, and
where the content had to come from a direct source read instead. See the
"Documentation" section in the root `CLAUDE.md` for the short version of the
regeneration workflow this backs.

Two tools were used, split by content type:

- **Architecture pages** (`docs/architecture/*`) — hand-authored using this
  repo's own graphify graph (`graphify query`/`explain`/`path`,
  `graphify-out/GRAPH_REPORT.md`).
- **Flow pages** (`docs/flows/*`) — built from a Trailmark call-graph pass
  (`QueryEngine.callees_of()` seeded at each route's `attack_surface()`
  entrypoint, plus the `branches` field for `alt`/`opt` error paths), which
  is what makes the cited error-branch sequence diagrams possible. This is a
  one-off tool invocation, not a graph persisted in this repo.

Both tools are consistently good at **orientation** (which files/functions
matter, who calls whom, fan-in/fan-out) and consistently unable to see
**column-level schema data, control flow semantics, business-rule intent, or
the deliberate absence of something** (a missing dedup check, a check that
used to work differently, two code paths that look related but aren't). That
gap is exactly where every direct source read below came from.

## Architecture pages (graphify)

### Project walkthrough

Unlike the other architecture pages, this one did **not** start from a
graphify query — it started as free-form conversational research answering
two direct questions ("walk me through the project assuming no Next.js
knowledge" and "do SSR pages use the API routes to reload content
dynamically?"), and was written up as a page afterward. `graphify query`
was tried first for the rendering-strategy question anyway, for orientation
(`graphify path "ItemsLibrary.tsx" "items/route.ts"` — returned "no directed
path found," which itself was a useful negative signal: the client
component and the route it calls at runtime aren't connected by a static
import edge, because the connection is a runtime `fetch()` call to a URL
string, not an import). Import-graph tools have no concept of "rendering
strategy" at all (SSR vs. CSR vs. static is a runtime/framework behavior,
not an import relationship), so the entire "use client" inventory, the
`page.tsx` list, and the dynamic-rendering claim were built from direct
`grep`/`Read` passes instead:

- `grep -rl '"use client"' src/app` for the full Client Component list, and
  `find src/app -name "page.tsx"` to confirm none of the 10 page files carry
  that directive — i.e. every page is a Server Component by default.
- `grep -rn "export const dynamic|revalidate|generateStaticParams|force-static|force-dynamic"`
  across `src/app` and `next.config.ts`, both empty, to confirm there's no
  static generation or ISR configured anywhere.
- Reading `src/app/layout.tsx:27` and `src/lib/current-user.ts:11` directly
  to find the actual mechanism that forces every page dynamic: `cookies()`
  in the root layout and `headers()` in `requireCurrentUser()` are both
  Next.js "dynamic APIs," and using either anywhere in a render tree opts
  that render out of static generation. This is a framework-semantics fact
  (which built-in function calls have this side effect) that no graph query
  over this codebase could surface — it had to come from knowing the
  Next.js 16 docs, then confirming the specific call sites exist here.
- `grep -n "router.refresh\|fetch(\`/api" src/app/items/*.tsx` to confirm,
  with exact line numbers, which client-side interactions hit an API route
  (`ItemsLibrary.tsx:153` pagination, `ItemForm.tsx:214` metadata lookup,
  `ItemRow.tsx:262`/`ParentArticleSelect.tsx:45` a parent-article picker)
  versus which call `router.refresh()` instead to re-run the Server
  Component (`ItemsLibrary.tsx:267`, `ItemForm.tsx:283`/`:289`) — the
  distinction the whole "hybrid SSR + CSR" section rests on.

### System overview

`graphify explain "getDb"`, `graphify explain "webauthn.ts"`, and `graphify explain "toErrorResponse"` were enough to build the module-boundary picture (who imports whom, at what degree) without grepping — the "Grouped by file" rollups in `explain` output made it obvious at a glance that `getDb()` is imported by nearly every route and every service, and that `toErrorResponse()` is imported by nearly every route but by *no* service (confirming the error-mapping boundary is exactly at the route layer).

`graphify query "How does the Next.js App Router call into the service layer, Drizzle ORM, and Postgres?"` was **not** useful — it returned an 8-node BFS seeded from loosely-related keyword matches (`postgres`, `next`, `drizzle-orm`, plus three unrelated markdown files from the `flashcards/` sample-content directory) with no edges connecting them. The graph has no synthesized "architecture layer" concept, and natural-language queries that don't name a specific symbol tend to seed on keyword overlap rather than structure. Getting the request-lifecycle picture required reading `src/proxy.ts`, `src/lib/current-user.ts`, and one representative route handler directly — graphify's import-edge data confirmed the *fan-out* (how many callers) but not the *sequencing* (proxy runs before pages/routes, current-user reads a header rather than hitting the DB) that this diagram depends on. Sequencing and control flow generally aren't things an import-graph captures — keep that in mind when using graphify to update this page later.

The later "Theme preference (light/dark)" section was added by hand, not regenerated from a graphify query, as part of the Technical Precision redesign: it documents a small, brand-new piece of infrastructure (`layout.tsx`'s cookie read, `ThemeToggle.tsx`) directly from the source that introduced it, then `graphify update .` was run afterward to keep the graph current for future edits — there was no value in querying a just-updated graph for code whose shape was already known from having just written it.

### Database schema

`graphify explain "schema.ts"` (52 edges) and `graphify query` both surface *which files import `schema.ts`* very well — that's how the module-structure page and the "tags.ts importers" claim on the schema page were confirmed without grepping. But graphify's extraction is import/call-edge-level, not column-level: it has no representation of a table's columns, types, foreign keys, or check constraints, and no `explain "items"` result distinguishes `items.parentId` from any other column. Building an accurate ER diagram — especially getting the FK cardinalities, the self-reference, and the two `invites.*_by` foreign keys pointing at the same `users` table with different `onDelete` behavior right — required reading `src/db/schema.ts` in full rather than querying the graph. This is a clear illustration of how graphify is best used here: it orients *which file to read* very effectively, while the actual content has to come from the source.

(This page also hit a real Mermaid gotcha worth remembering: `erDiagram` attribute keys only accept the literal, unquoted, comma-separated tokens `PK`, `FK`, `UK` — e.g. `uuid tag_id PK, FK "comment"`. A composite key written as a single token like `PK_FK` silently fails to parse as a key and can blank the whole diagram. Confirmed against Mermaid's actual ER-diagram lexer (`/^(?:\b((?:PK)|(?:FK)|(?:UK))\b)/i` in `node_modules/mermaid/dist/chunks/.../erDiagram-*.mjs`), not guessed.)

### Module structure

The community/god-node data came entirely from `graphify-out/GRAPH_REPORT.md` (read once, in full — 283 lines) plus two confirming `graphify path`/`graphify query` calls; no raw grep was needed to *find* the modules. The manual work was almost entirely **synthesis**: turning "41 communities with auto-generated single-node labels" into "these five actually correspond to auth / items / flashcards / wiki / shared infra" required judgment calls a tool can't make — e.g. deciding that `webauthn.ts`'s community *is* "auth" even though `session.ts` (arguably a distinct concern) is clustered inside it too, or that the four `package.json`-derived communities (`dependencies`, `devDependencies`, `scripts`, `package.json` itself) aren't architecturally meaningful and should be dropped from the diagram entirely. Graphify surfaces the clusters; it doesn't label them with intent.

### Error handling & logging

Built for ticket 11, after the error-handling/logging/mutation-logging initiative (tickets 01–10) landed. Orientation came entirely from graphify: `graphify query "AppError withErrorHandling response envelope"` and `graphify query "mutation logging"` surfaced the full node set (`errors.ts`, `api-errors.ts`, `logging.ts`, `mutation-log.ts`, every route and service that touches them) in one scoped subgraph each; `graphify explain "request correlation id"` turned up only the archived ticket doc (the concept lives in code, not as a named symbol, so `explain` had little to add there — `graphify path "proxy.ts" "logging.ts"` was more useful, confirming the direct one-hop `imports_from` edge); `graphify path "withErrorHandling" "AppError"` returned a *call*-edge path through `currentUserId()`/`getCurrentUser()`/`UnauthorizedError` rather than the `catch (err instanceof AppError)` type-check relationship the page actually needed — a reminder that `path` traces the edges the parser recorded (calls, imports, inheritance), not "is logically related to," so the actual AppError-taxonomy-to-envelope mapping came from reading `api-errors.ts`'s `catch` block directly rather than trusting that path result.

None of graphify's query/explain/path output includes exact string literals, so every concrete detail on the page — the precise envelope shape (`{ error: { code, message, requestId, issues? } }`, including that `issues` is conditionally spread rather than always present), the derived-`code` string-transform logic in `toErrorCode()`, the exact `REDACT_FIELDS` regex/string list, the dev-vs-prod sink branch, and the `MutationLogFields.entity` union's eight literal values — came from reading `src/services/errors.ts`, `src/lib/api-errors.ts`, `src/lib/logging.ts`, `src/lib/request-id.ts`, `src/proxy.ts`, and `src/services/mutation-log.ts` directly. A `graphify query "logMutationSuccess call sites items flashcards"` call was also used to confirm every entity's call sites (items, flashcards, webauthn, session, invites, tags) in one pass rather than grepping each service file individually — this is the one query in this page's research that graphify handled essentially completely on its own, with only one representative call site (`items.ts`) then read directly to confirm the exact argument shape (`entity`/`entityId`/`changedFields`) used at a real call site.

## Flow pages (Trailmark)

### Login with a passkey

The call sequence (`route -> webauthn.ts -> session.ts -> db`, with `auth-cookies.ts` calls interleaved) came from walking Trailmark's call graph programmatically — `QueryEngine.callees_of()` seeded at the two route-handler entrypoints (`app.api.auth.login.options.route:POST` and `app.api.auth.login.verify.route:POST` in the `attack_surface()` output), followed transitively, with each edge's `to_loc` giving the file:line cited on the page. Trailmark has no built-in "sequence diagram" generator — the diagram was hand-drawn from that call-graph data.

The `alt`/`opt` branches came from a second Trailmark query: pulling the `branches` field (condition text + line number, part of the parser's cyclomatic-complexity metadata) for each function on the path (`verify/route.ts:POST`, `verifyPasskeyLogin`). That gave the exact conditions and line numbers directly — no manual grep needed to locate them, though reading the surrounding source was still necessary to turn `"(!verification.verified)"` into an accurate explanation of *what* that covers (signature vs. challenge mismatch), since Trailmark's branch data is just the condition expression, not its semantics.

The one part no graph query could supply: `db.select().from(...).where(...)` calls resolve as unresolved `proxy.*` nodes (e.g. `proxy.unresolved:db_.select__.from_webauthnCredentials__.where`) rather than as edges into a named function, because Drizzle's fluent query builder is dynamic method chaining, not a single resolvable call target. The proxy node names still hint at the table and shape of each query, but confirming exactly what each one selects/updates required reading `webauthn.ts:344-378` and `session.ts:21-31` directly.

Ticket 14 (WebAuthn response-body schema validation) later added the `body.response fails authenticationResponseSchema` `alt` branch by hand, directly from `verify/route.ts` and the new `services/auth/webauthn-schema.ts` — not from a fresh Trailmark pass, since it's a single new branch on an already-mapped call path rather than a change worth re-walking the whole graph for.

### Register with invite

The route → service call chains and every `alt`/`opt` branch came from Trailmark's `QueryEngine.callees_of()`, seeded at `app.api.auth.invite.options.route:POST` and `app.api.auth.invite.verify.route:POST` from `attack_surface()`, combined with the `branches` field (condition text + line) on each function on the path — the same approach as the login flow. The one thing that call graph alone doesn't make obvious: that `/api/auth/register/*` and `/api/auth/invite/*` are two *separate* registration entrypoints rather than one route reused for both cases — confirming that required reading `assertBootstrapEligible`'s doc comment and call sites directly, since a call-graph edge shows *that* a function is called, not the business rule ("invite-only once bootstrapped") that keeps the two paths from overlapping in practice.

Ticket 14 later added the `body.response fails registrationResponseSchema` `alt` branch by hand (same rationale as the login-flow page's equivalent note): a single new branch from `verify/route.ts` and `services/auth/webauthn-schema.ts`, not a fresh Trailmark pass.

Ticket 16 (Zod body validation for `invite/options`) replaced the hand-rolled `typeof`/`trim` check the `alt token or displayName missing/blank` branch cited with `parseOrThrow(inviteOptionsBodySchema, body)`; only that branch's line citation changed (the call chain past it is untouched), so — same as account recovery below — it was hand-edited rather than re-run through Trailmark.

### Account recovery

Route → service call chains and their `alt` branches came from Trailmark's `QueryEngine.callees_of()`, seeded at `app.api.auth.recover.options.route:POST` and `app.api.auth.recover.verify.route:POST` from `attack_surface()`, plus the `branches` field (condition + line) on each function on the path — the same method as the other auth flow pages. The "recovery codes are never regenerated" finding did **not** come from the call graph at all: it came from grepping every call site of `generateRecoveryCodes` across the codebase and finding exactly two, both at account-creation time, with none anywhere in the recovery path. A call graph shows edges that exist; confirming the *absence* of a call (nothing calls this function from the recovery flow) is a search over the whole graph's call sites, not a single `callees_of()` walk from one entrypoint.

Ticket 14 later added the `body.response fails registrationResponseSchema` `alt` branch by hand, the same way and for the same reason as on the other two auth-verify flow pages.

Ticket 16 (Zod body validation for `recover/options`) replaced the hand-rolled `typeof`/`trim` check the `alt code missing/blank` branch originally cited with `parseOrThrow(recoverOptionsBodySchema, body)` — this touched only that one `alt` branch's condition/line citation and the 400 body shape (now the `withErrorHandling` `ValidationError` envelope), not the call chain itself, so it was hand-edited directly in the page rather than re-run through a full Trailmark pass; the rest of the diagram is unchanged from the original pass above.

### Admin: manage invites

The route → service call chain and its one `alt` branch came from Trailmark's `QueryEngine.callees_of()`, seeded at `app.api.admin.invites.route:POST` from `attack_surface()`. Trailmark's pre-analysis pass reported an **empty privilege-boundary subgraph** for this codebase — it has no data distinguishing "this call site enforces admin-only" from any other call edge, since that's an application-level runtime check (`actor.role !== "admin"`) rather than a structural language feature the parser can see (no route decorator, no framework-level guard function it could special-case). Confirming that `proxy.ts` has no role awareness, and that `createInvite`'s DB-role-check is the actual enforcement point, required reading `proxy.ts`, `admin/invite/page.tsx`, and `invites.ts` directly rather than querying the graph.

### Item lifecycle

The `createItem`/`updateItem`/`deleteItem` call chains and their `alt` branches came from Trailmark's `QueryEngine.callees_of()` walked from the four route entrypoints in `attack_surface()` (`app.api.items.route:POST`, `app.api.items.[id].route:PATCH`/`:DELETE`, `app.api.items.metadata.route:POST`), combined with the `branches` field (condition text + line) on each function on the path — the same approach used for items import/export. The one thing the graph doesn't capture: that the metadata-preview endpoint and `createItem`'s own internal fetch hit the same URL independently rather than sharing a result. That's a data-flow fact (two separate `fetch()` call sites with no state passed between the two HTTP requests), not a call-graph edge, so it's called out from reading `metadata/route.ts` and `items.ts:126-130` directly.

Ticket 17 (Zod body validation for `POST /api/items`, `PATCH /api/items/[id]`, and `POST /api/items/metadata`) replaced each route's hand-rolled `typeof`/`isStringArray` checks with a colocated schema (`items/schema.ts`, `items/[id]/schema.ts`, `items/metadata/schema.ts`) run through `parseOrThrow`. This collapsed several previously-separate `alt` branches (kind check, kind-conditional title/content/url check, tags check, parentId check) into one `alt body fails <schema> (…, via schema.ts + parseOrThrow in lib/validation.ts — ticket 17)` branch per route — the same consolidation ticket 16 applied to the auth options pages — plus a new `url must be a valid URL` branch on the metadata route that didn't exist before (the hand-rolled check only ever verified presence, never format). Only these `alt` branches and their response-body shapes changed; the call chains past "body valid" are untouched, so this was hand-edited directly in `item-lifecycle.md` rather than re-run through a full Trailmark pass.

Ticket 19 (query-string param validation: `?limit=`/`?kind=`/`?tags=`/`?query=`/`?cursor=` on the list routes, `?cascade=` on the item DELETE route) added a prose paragraph to the "View" section covering `GET /api/items`'s new `itemKindFilterSchema`/`limitQuerySchema`/`tagsQuerySchema`/`queryParamSchema`/`cursorParamSchema` (`src/lib/query-schemas.ts`) rejection behavior, and a new `alt` branch on `DELETE /api/items/[id]`'s cascade handling for `cascadeQuerySchema`. Neither is a route this codebase's call-graph tooling diagrams as a full sequence (the GET list route was already prose-only; the DELETE cascade check is a one-line addition to an already-narrated paragraph), so both were hand-edited directly from the route/schema source rather than pulled from a fresh Trailmark pass.

### Items import/export

The route → service → db call chains for both flows came from Trailmark's call graph, seeded at three entrypoints from `attack_surface()` (`app.api.items.import.route:POST`, `app.api.items.import.preview.route:POST`, `app.api.items.export.route:GET`) and walked with `QueryEngine.callees_of()` to a depth of 8, which reached 33 first-party nodes across 170 call edges before bottoming out at unresolved `proxy.*` calls (Drizzle's query-builder chaining, `gray-matter`'s `matter()`/`matter.stringify()`, `Array.isArray`, etc. — none of those resolve to a named function node the way first-party calls do). That walk is what surfaced `parseItemImportBody` being shared verbatim between the preview and commit routes, and `parseItemsImportFile` being called fresh by both preview and `importItemsFile` (i.e. **not** cached between the two requests).

The `branches` field on each function node (condition text + line number) supplied every `alt` branch and its exact source line — `request-fields.ts` lines 36/40/63/67 and `items-import.ts` lines 45/50/51 for validation, `items-import.ts:141-163`'s single `for_in_statement` branch pointing at the transaction loop. The **duplicate-detection design rationale** on the page is the one piece that came from reading source directly rather than graph output: it's a code *comment* explaining an intentional non-feature, and Trailmark's graph (correctly) has no representation for "logic that was deliberately not written."

Ticket 19 replaced the Export diagram's `kind` check — the removed `parseKindParam` plus a hand-rolled flat 400 — with `exportKindParamSchema` (`src/lib/query-schemas.ts`) run through `parseOrThrow`, updating that one `alt` branch's condition/line citation and 400 body to the `withErrorHandling` `ValidationError` envelope every other schema-backed branch on this page already uses. The call chain past "kind valid" is untouched, so this was hand-edited directly from the route/schema source rather than re-run through a fresh Trailmark pass.

### Flashcard lifecycle

Call chains and `alt` branches came from Trailmark's `QueryEngine.callees_of()` seeded at `app.api.flashcards.route:POST` and `app.api.flashcards.[id].route:PATCH`/`:DELETE` (from `attack_surface()`), combined with the `branches` field (condition text + line) for each function on the path. The create/update/delete permission asymmetry itself is stated directly in `updateFlashcard`'s and `canDeleteFlashcard`'s doc comments (`flashcards.ts:139-150`, `permissions.ts:18-20`). Ticket 26 moved `canDeleteFlashcard` into the pure `permissions.ts` (so the client `FlashcardRow` can import it); the page's `flashcards.ts` line citations were re-pointed by hand at that point rather than via a fresh Trailmark pass, since no call edge changed — only line positions, including the historical note about `canDeleteFlashcard` once being creator-only; that context came from reading the source, since a call graph has no representation for "this used to work differently."

Ticket 18 (Zod body validation for create/update) replaced the hand-rolled `typeof`/`trim`/`isStringArray` checks the Create diagram's four separate `alt` branches (front/back/source/tags) and the Edit diagram's four separate `alt` branches (body-not-object, front/back/source-not-string, tags-not-string[]) used to cite with a single `parseOrThrow(createFlashcardBodySchema, body)` / `parseOrThrow(updateFlashcardBodySchema, body)` call each — collapsing each route's four-way branch into one `alt` (every shape violation now reported together as one `issues[]`) and updating the 400 body to the `withErrorHandling` `ValidationError` envelope. Only those branches' line citations and shape changed (the call chain past them, and the tags business-rule `alt`s inside `createFlashcard`/`updateFlashcard`, are untouched), so — same rationale as ticket 16's auth-route edits above — this was hand-edited directly in the page rather than re-run through a full Trailmark pass.

Ticket 19 added a new "List" prose section above ahead of the permission-asymmetry note, covering `GET /api/flashcards`'s `limitQuerySchema`/`tagsQuerySchema`/`cursorParamSchema` (shared with `GET /api/items` via `src/lib/query-schemas.ts`) rejection behavior — this route had no prior "View"/"List" coverage on this page at all (unlike `item-lifecycle.md`'s existing one), so this is new prose rather than an edited `alt` branch. A short note was also added after the Delete diagram explaining why this ticket's `?cascade=` schema was deliberately *not* wired into `DELETE /api/flashcards/[id]`: `deleteFlashcard` has no cascade concept, unlike `deleteItem`. Both were hand-written directly from the route/schema source (there's no call-graph data for "a query param this route doesn't read"), not from a fresh Trailmark pass.

### Flashcards import/export

Route → service → db call chains for both import routes and the export route came from Trailmark's `QueryEngine.callees_of()`, seeded at `app.api.flashcards.import.route:POST`, `app.api.flashcards.import.preview.route:POST`, and `app.api.flashcards.export.route:GET` from `attack_surface()`. The `branches` field on each function supplied every `alt`'s condition and line, the same way as items import/export. The `xmax = 0` upsert-detection idiom is a raw SQL fragment (`` sql`(xmax = 0)` `` inside a Drizzle `.returning()`) rather than a call to a named function, so it doesn't appear as a call-graph edge at all — it was found and understood by reading `flashcards-import.ts:99-140` directly, and is exactly the kind of Postgres-specific detail a call graph has no way to surface on its own.

### Flashcard study session

Because this flow has no server round trip past the initial page load, it doesn't show up in Trailmark's `attack_surface()` output at all (which only enumerates untrusted-external entrypoints — API routes) — there is nothing to seed a `callees_of()` walk from beyond the Server Component's own initial `listFlashcards`/`listFlashcardTags` calls, which are a one-line fetch already covered by the flashcard-lifecycle page's `listFlashcards` usage. The stage machine, input-method dispatch, and the boundary-swipe special case were built by reading `StudySession.tsx` and `deck.ts` directly — Trailmark's call graph can (and does) confirm which functions call which (`deck.ts`'s exports are called from `StudySession.tsx` and nowhere else), but the actual state-transition logic — which stage change follows which UI event, and why the swipe-boundary check exists as a narrow exception rather than a general rule — lives in prose comments and UI-event wiring, not in call-graph edges.

### Wiki article management

The generic item create/edit call chains (route → `items.ts` → `getDb()`/Drizzle) were walked via Trailmark's `QueryEngine.callees_of()` seeded at `app.api.items.route:POST` and `app.api.items.[id].route:PATCH`/`:DELETE` from `attack_surface()`, the same way as the other flow pages. The wiki-specific branching — `deleteArticleWithChildren`'s two mutually-exclusive modes, and `wouldCreateCycle`'s cycle-detection logic — came from the same `branches`-field walk (condition text + line number) used elsewhere, but the **why** behind each branch (why promote re-parents to the article's own parent rather than its grandparent; why cascade needs a full tree rebuild rather than a recursive `DELETE ... WHERE parent_id = ...`) is only in the doc comments at `wiki.ts:1-17` and `:147-163`, so those were read directly rather than inferred from the call graph.

## Ticket 12: error-envelope refresh (all `alt`/`opt` error-path branches)

Tickets 05–08 migrated every route under `src/app/api/items/**`, `flashcards/**`, `auth/**`, and `admin/invites/route.ts` off the deprecated `toErrorResponse` (a flat `{ error: "message" }` body) onto the central `withErrorHandling` wrapper (`src/lib/api-errors.ts`), which returns `{ error: { code, message, requestId } }` for any thrown `AppError` subclass, and a generic `{ error: { code: "INTERNAL", message: "Something went wrong. Please try again." } }` 500 for anything else. Tickets 05 and 06's own commit messages flagged this drift explicitly and deferred the doc fix to this ticket (the same deferral ticket 04 had already established for `account-recovery.md`). This pass regenerated every `docs/flows/*` page whose diagram cited a route now wrapped by `withErrorHandling`:

- `login-with-passkey.md`, `account-recovery.md`, `register-with-invite.md` — auth routes (ticket 07)
- `admin-manage-invites.md` — the one admin route (ticket 07)
- `flashcard-lifecycle.md`, `flashcards-import-export.md` — flashcards routes (ticket 06)
- `item-lifecycle.md`, `items-import-export.md`, `wiki-article-management.md` — items routes, shared by both pages since wiki pages go through the same `POST`/`PATCH`/`DELETE /api/items*` handlers (ticket 05)

`flashcard-study-session.md` was left untouched — it has no server round trip past the initial page load (see its own section above), so no route wrapped by `withErrorHandling` appears in its diagram at all.

Per `CLAUDE.md`, this was done via a fresh, one-off Trailmark call-graph pass (`trailmark analyze src -l typescript`, plus `trailmark entrypoints src -l typescript --json`), not graphify — no graph was persisted in this repo. Two things came directly out of that pass:

- **The wrapper's own `branches` data confirmed the fix.** `lib.api-errors:withErrorHandling`'s two branches (`catch_clause` at `api-errors.ts:74-95`, `(err instanceof AppError)` at `:75-85`) are exactly the `opt any other (non-AppError) thrown error` / per-`AppError` split every regenerated diagram's catch-all now reflects.
- **This same refactor broke Trailmark's own visibility into every route handler it wraps** — a real, notable regression worth recording here rather than silently working around. Before tickets 05–08, a route was `export async function POST(request) {...}`, a named function Trailmark parses and reports `branches`/`cyclomatic_complexity` for. After, it's `export const POST = withErrorHandling(async (request) => {...})` — an anonymous arrow function passed as a call argument, which Trailmark's parser does not extract branch data for at all (confirmed: every route file's function-node listing in the fresh graph now has zero entries for its `GET`/`POST`/`PATCH`/`DELETE` handlers, only for genuinely top-level helpers like `parseLimitParam`). The `entrypoints`/`attack_surface()` detection was affected the same way — a fresh `trailmark entrypoints` pass over `src` returned zero entrypoints, where prior passes (see the auth flow pages above) could seed `callees_of()` walks directly from route entrypoints. Every `alt`/`opt` branch and every thrown-vs-flat distinction in this pass's nine pages therefore came from reading each route/service file directly (already-known ticket 05–07 commit messages narrowed which validations moved from flat `NextResponse.json` to real `throw new ValidationError(...)`, which direct reads then confirmed line-by-line), with the Trailmark graph used only for the wrapper-level confirmation above and for orientation on which files still had directly-parseable branch data (the service-layer functions, e.g. `items.ts`, `webauthn.ts`, `flashcards-import.ts`, which are still named top-level functions and were unaffected).
