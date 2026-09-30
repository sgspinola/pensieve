# Flashcard Lifecycle

Covers create, edit, and delete for a flashcard. Routes:
`src/app/api/flashcards/route.ts` (GET list / POST create) and
`src/app/api/flashcards/[id]/route.ts` (PATCH / DELETE), backed by
`src/services/flashcards/flashcards.ts`. See
[Flashcards import/export](/flows/flashcards-import-export) for the bulk
frontmatter-file path, and [Flashcard study session](/flows/flashcard-study-session)
for how cards are consumed after creation.

## List: `?limit=`/`?tags=` validation

`GET /api/flashcards` (`src/app/api/flashcards/route.ts:58-72`) always pages
(keyset, ticket 04) — `?limit=` defaults to `FLASHCARDS_PAGE_SIZE` when
absent, but ticket 19 replaced the removed `parseLimitParam`'s silent
clamp-to-default with strict rejection: `limitQuerySchema`
(`src/lib/query-schemas.ts`, shared with `GET /api/items`), run through
`parseOrThrow`, now returns `400 { error: { code: "VALIDATION", issues:
[{ field: "", message }] } }` for a non-integer or out-of-range `?limit=`
instead of silently substituting the default. `?tags=`/`?cursor=` are
validated too (`tagsQuerySchema`/`cursorParamSchema`, same shared module),
though neither can actually reject anything — any string, or absence, is
valid input to each, and a malformed `?cursor=` is still only ever caught
downstream, at `listFlashcards`'s decode step.

## The permission asymmetry, up front

Unlike items, **update and delete are not governed by the same rule.**
`updateFlashcard` (`src/services/flashcards/flashcards.ts:129-140`) is
documented as deliberately open-edit: "any authenticated actor may update
any flashcard, with no ownership/role check at all." `deleteFlashcard`
(`flashcards.ts:176-198`), by contrast, gates on `canDeleteFlashcard`
(`flashcards.ts:104-114`) — admin, or the flashcard's own creator — the
same creator-or-admin rule `items.ts`'s `canModifyItem` uses. A comment on
`canDeleteFlashcard` even notes this was **originally creator-only with no
admin case**, and was widened to admin-or-creator later because the
creator-only version "had no recorded rationale." Any signed-in member can
therefore edit a card's front/back/source/tags freely, but can only delete
a card they created (or if they're an admin) — worth knowing before
assuming the two operations share one guard.

## Create

```mermaid
sequenceDiagram
    actor Browser
    participant Route as POST /api/flashcards
    participant Svc as services/flashcards/flashcards.ts
    participant TagsSvc as services/tags/tags.ts
    participant DB as Postgres (via Drizzle)

    Browser->>Route: POST { front, back, source, tags }
    alt body fails createFlashcardBodySchema (schema.ts, route.ts:82)
        Note right of Route: front/back/source missing or blank-after-<br/>trim, and/or tags present but not string[] —<br/>every violation reported together as one issues[]
        Route-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "Validation failed", requestId, issues } }
    else body valid
        Route->>Route: getCurrentUser()
        Route->>Svc: createFlashcard(db, { creatorId, front, back, source, tags })
        Svc->>Svc: normalizeTagNames(tags ?? [])
        alt normalizes to zero tags (flashcards.ts:73-76)
            Note right of Svc: omitted, [], or every name<br/>blank/whitespace — at least one<br/>real tag is required (ticket 04)
            Svc-->>Route: throw ValidationError("At least one tag is required")
            Route-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "At least one tag is required", requestId } }
        else at least one tag
            Svc->>DB: insert into flashcards (front, back, source,<br/>front_hash = sha256(trim(front)), created_by) returning *
            alt frontHash UNIQUE violation (flashcards.ts:48-57)
                DB-->>Svc: unique constraint error
                Svc-->>Route: throw ValidationError("A flashcard with this exact question already exists")
                Route-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "A flashcard with this exact question already exists", requestId } }
            else insert succeeds
                DB-->>Svc: new row
                Svc->>TagsSvc: setFlashcardTags(row.id, normalizedTags)
                Svc-->>Route: flashcard
                Route-->>Browser: 201 { flashcard }
            end
        end
    end
```

`front_hash` (`flashcards.ts:85`, a `sha256Hex` of the *trimmed* `front`
text) is never accepted as caller input — it's derived server-side, so
there's nothing for a client to spoof or drift out of sync. The
`flashcards.front_hash` column carries a `UNIQUE` constraint (see
[Database schema](/architecture/database-schema)), which is what makes the
duplicate-question rejection above a real database-level guarantee rather
than an application-level race.

## Edit

```mermaid
sequenceDiagram
    actor Browser
    participant Route as PATCH /api/flashcards/[id]
    participant Svc as services/flashcards/flashcards.ts
    participant TagsSvc as services/tags/tags.ts
    participant DB as Postgres (via Drizzle)

    Browser->>Route: PATCH { front?, back?, source?, tags? }
    alt id not a valid UUID (route.ts:22, request-fields.ts idParamSchema)
        Route-->>Browser: 400 { error: { code: "VALIDATION", issues } }
    else body fails updateFlashcardBodySchema (schema.ts, route.ts:24)
        Note right of Route: front/back/source present but not a string,<br/>and/or tags present but not string[] — a<br/>non-object body also lands here
        Route-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "Validation failed", requestId, issues } }
    else body valid
        Route->>Route: getCurrentUser()
        Note right of Route: user is forwarded as `actor` for<br/>signature symmetry with updateItem,<br/>but updateFlashcard never reads it
        Route->>Svc: updateFlashcard(db, user, id, updates)
        Svc->>DB: getFlashcard(id)
        alt not found (flashcards.ts:96-102)
            Svc-->>Route: throw NotFoundError("Flashcard not found")
            Route-->>Browser: 404 { error: { code: "NOT_FOUND",<br/>message: "Flashcard not found", requestId } }
        else found — no ownership check
            opt tags provided
                Svc->>Svc: normalizeTagNames(tags)
                alt normalizes to zero tags (flashcards.ts:155-157)
                    Svc-->>Route: throw ValidationError("At least one tag is required")
                    Route-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "At least one tag is required", requestId } }
                end
            end
            opt front provided
                Svc->>Svc: frontHash = sha256Hex(trim(front))
                Note right of Svc: recomputed in lockstep so front_hash<br/>never drifts from the text it derives from
            end
            Svc->>DB: update flashcards set ...columnUpdates,<br/>updated_at = now() where id = :id returning *
            alt frontHash UNIQUE violation (flashcards.ts:48-57)
                DB-->>Svc: unique constraint error
                Svc-->>Route: throw ValidationError("A flashcard with this exact question already exists")
                Route-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "A flashcard with this exact question already exists", requestId } }
            else update succeeds
                DB-->>Svc: updated row
                opt tags provided
                    Svc->>TagsSvc: setFlashcardTags(id, normalizedTags)
                end
                Svc-->>Route: flashcard
                Route-->>Browser: 200 { flashcard }
            end
        end
    end
```

Note that an explicit `tags: []` (or an array that normalizes to nothing
once blanks are filtered) is rejected the same way at both create and
update — a flashcard's last tag can't be stripped this way. Omitting
`tags` from the PATCH body entirely, by contrast, always leaves the
current tags untouched (same convention as `items.ts`).

## Delete

```mermaid
sequenceDiagram
    actor Browser
    participant Route as DELETE /api/flashcards/[id]
    participant Svc as services/flashcards/flashcards.ts
    participant TagsSvc as services/tags/tags.ts
    participant DB as Postgres (via Drizzle)

    Browser->>Route: DELETE /api/flashcards/:id
    alt id not a valid UUID (route.ts:50-51, request-fields.ts idParamSchema)
        Route-->>Browser: 400 { error: { code: "VALIDATION",<br/>message, requestId, issues } }
    else id valid
        Route->>Route: getCurrentUser()
        Route->>Svc: deleteFlashcard(db, user, id)
        Svc->>DB: getFlashcard(id)
        alt not found (flashcards.ts:96-102)
            Svc-->>Route: throw NotFoundError("Flashcard not found")
            Route-->>Browser: 404 { error: { code: "NOT_FOUND",<br/>message: "Flashcard not found", requestId } }
        else found
            alt !canDeleteFlashcard(actor, flashcard) (flashcards.ts:112-114, :185-187)
                Note right of Svc: admin, or actor.id === flashcard.createdBy<br/>— otherwise rejected. Unlike updateFlashcard,<br/>this check IS enforced.
                Svc-->>Route: throw UnauthorizedError("You do not have permission to delete this flashcard")
                Route-->>Browser: 401 { error: { code: "UNAUTHORIZED",<br/>message: "You do not have permission to delete this flashcard", requestId } }
            else creator or admin
                Svc->>DB: select tag_id from flashcard_tags where flashcard_id = :id
                Svc->>DB: delete from flashcards where id = :id
                Svc->>TagsSvc: pruneUnusedTags(deletedTagRows.tagIds)
                Svc-->>Route: void
                Route-->>Browser: 204
            end
        end
    end

    opt any other (non-AppError) thrown error (api-errors.ts:74-95, withErrorHandling catch_clause)
        Route-->>Browser: 500 { error: { code: "INTERNAL",<br/>message: "Something went wrong. Please try again.", requestId } }
        Note right of Route: withErrorHandling wraps the whole handler — every<br/>AppError throw above and this fallback come from<br/>its one catch block, not a per-route try/catch.
    end
```

Ticket 19 added `?cascade=` validation (`cascadeQuerySchema`,
`src/lib/query-schemas.ts`) to `DELETE /api/items/[id]`'s equivalent
diagram, where it gates whether deleting a wiki article also deletes its
children. It's deliberately absent here: `deleteFlashcard` takes no
`cascade`/options argument at all — flashcards have no parent/child
relationship to cascade through — and this handler has never read
`searchParams`, so there's nothing for this ticket to validate.
