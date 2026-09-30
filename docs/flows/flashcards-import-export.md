# Flashcards Import / Export

Members can batch-import flashcards from a frontmatter-delimited Markdown
file (preview, then commit) and export every flashcard back out in the same
format. Routes: `src/app/api/flashcards/import/preview/route.ts`,
`src/app/api/flashcards/import/route.ts`, and
`src/app/api/flashcards/export/route.ts`, backed by
`src/services/flashcards/flashcards-import.ts` and
`src/services/flashcards/flashcards-export.ts`.

This is the flashcards counterpart to
[Items import/export](/flows/items-import-export) and shares the same
preview-then-commit shape, but **it behaves differently in one important
way: it dedupes.**

## The headline difference: hash-based upsert, not append-only

Items import never matches an existing row — every entry always creates a
new item, by explicit design (see
[Items import/export](/flows/items-import-export)). Flashcards import does
the opposite: `importFlashcardsFile`
(`src/services/flashcards/flashcards-import.ts:85-140`) **upserts on
`frontHash`** — a `SHA-256` of the entry's trimmed `front` text, backed by
the `flashcards.front_hash` `UNIQUE` constraint (see
[Database schema](/architecture/database-schema)). An entry whose front
text matches an existing card's `front_hash` updates that card's
`back`/`source`/tags in place; every other entry creates a new card. Both
created and updated cards are attributed to the importing member
(`creatorId`), never to any authorship implied by the file itself.

The upsert is a single Drizzle `.onConflictDoUpdate({ target:
flashcards.frontHash, ... })` call per entry
(`flashcards-import.ts:111-127`), and whether that particular call inserted
or updated is read off the classic Postgres idiom for exactly this
question: a fresh insert's `xmax` system column is `0`; an updated row's
`xmax` is the transaction ID that just wrote it. The
`` `.returning({ ..., inserted: sql`(xmax = 0)` })` `` clause turns that
into a plain boolean the code branches on (`flashcards-import.ts:127-133`) to build the `{ created,
updated }` counts returned to the caller — no separate `SELECT` needed to
find out which happened.

## Import: preview, then commit

```mermaid
sequenceDiagram
    actor Browser
    participant PreviewRoute as POST /api/flashcards/import/preview
    participant ImportRoute as POST /api/flashcards/import
    participant Fields as lib/request-fields.ts
    participant ImportSvc as services/flashcards/flashcards-import.ts
    participant FM as lib/frontmatter-file.ts
    participant TagsSvc as services/tags/tags.ts
    participant DB as Postgres (via Drizzle)

    Browser->>PreviewRoute: POST { file }
    PreviewRoute->>Fields: parseImportFileBody(body)
    alt body/file invalid (request-fields.ts)
        Fields-->>PreviewRoute: { ok:false, error }
        PreviewRoute-->>Browser: 400 { error }
    else file present
        Fields-->>PreviewRoute: { ok:true, file }
        PreviewRoute->>PreviewRoute: getCurrentUser()
        PreviewRoute->>ImportSvc: parseFlashcardsImportFile(file)
        ImportSvc->>FM: splitFrontmatterEntries(raw)
        alt no parseable frontmatter blocks (FrontmatterSplitError)
            FM-->>ImportSvc: throw FrontmatterSplitError
            ImportSvc-->>PreviewRoute: throw ValidationError("Could not parse the file: <reason>")
            PreviewRoute-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "Could not parse the file: <reason>", requestId } }
        else chunks split OK
            FM-->>ImportSvc: chunks[]
            loop each chunk, via gray-matter
                alt missing "front" (flashcards-import.ts:45)
                    ImportSvc-->>PreviewRoute: throw ValidationError('Entry N: missing "front"')
                    PreviewRoute-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: 'Entry N: missing "front"', requestId } }
                else missing "source" (flashcards-import.ts:46)
                    ImportSvc-->>PreviewRoute: throw ValidationError('Entry N: missing "source"')
                    PreviewRoute-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: 'Entry N: missing "source"', requestId } }
                else empty answer body (flashcards-import.ts:47)
                    ImportSvc-->>PreviewRoute: throw ValidationError('Entry N: empty answer body')
                    PreviewRoute-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: 'Entry N: empty answer body', requestId } }
                else "tags" not a string list (flashcards-import.ts:48-50)
                    ImportSvc-->>PreviewRoute: throw ValidationError('Entry N: "tags" must be a list of strings')
                    PreviewRoute-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: 'Entry N: "tags" must be a list of strings', requestId } }
                else tags normalize to zero (flashcards-import.ts:51-54)
                    Note right of ImportSvc: unlike items import, a flashcard<br/>entry needs at least one real tag —<br/>ticket 04
                    ImportSvc-->>PreviewRoute: throw ValidationError('Entry N: missing "tags" in frontmatter')
                    PreviewRoute-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: 'Entry N: missing "tags" in frontmatter', requestId } }
                else entry valid
                    ImportSvc->>ImportSvc: collect { front, tags, source, back }
                end
            end
            ImportSvc-->>PreviewRoute: ParsedFlashcardEntry[]
            PreviewRoute-->>Browser: 200 { count: entries.length }
        end
    end

    Note over Browser: Member reviews the "N entries parsed"<br/>count, then clicks Import

    Browser->>ImportRoute: POST { file }
    ImportRoute->>Fields: parseImportFileBody(body)
    alt invalid (same checks as preview)
        Fields-->>ImportRoute: { ok:false, error }
        ImportRoute-->>Browser: 400 { error }
    else body valid
        ImportRoute->>ImportRoute: getCurrentUser()
        ImportRoute->>ImportSvc: importFlashcardsFile(db, file, user.id)
        ImportSvc->>ImportSvc: parseFlashcardsImportFile(raw)
        Note right of ImportSvc: re-parses from scratch — same as items<br/>import, the preview's result isn't reused
        alt parse/validation fails (same branches as preview)
            ImportSvc-->>ImportRoute: throw ValidationError
            ImportRoute-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "...", requestId } }
        else all entries valid
            ImportSvc->>DB: db.transaction(async tx => ...)
            loop each parsed entry
                ImportSvc->>DB: insert into flashcards (front, back, source,<br/>front_hash, created_by)<br/>on conflict (front_hash) do update<br/>set back, source, created_by, updated_at<br/>returning id, (xmax = 0) as inserted
                DB-->>ImportSvc: { id, inserted }
                alt inserted === true
                    ImportSvc->>ImportSvc: created++
                else inserted === false (frontHash matched an existing row)
                    ImportSvc->>ImportSvc: updated++
                end
                ImportSvc->>TagsSvc: setFlashcardTags(tx, id, entry.tags)
            end
            DB-->>ImportSvc: transaction commits
            ImportSvc-->>ImportRoute: { created, updated }
            ImportRoute-->>Browser: 200 { created, updated }
        end
    end
```

Like items import, this is **all-or-nothing at two levels**: parsing
(`parseFlashcardsImportFile` validates every entry before any write
happens) and writing (the whole loop runs inside one `db.transaction`, so a
failure partway through can't leave a partial batch committed). The
difference is purely in what a "successful" write does per entry — create
vs. upsert — not in the atomicity guarantee around it.

## Export

```mermaid
sequenceDiagram
    actor Browser
    participant ExportRoute as GET /api/flashcards/export
    participant ExportSvc as services/flashcards/flashcards-export.ts
    participant FlashcardsSvc as services/flashcards/flashcards.ts
    participant DB as Postgres (via Drizzle)

    Browser->>ExportRoute: GET /api/flashcards/export
    ExportRoute->>ExportRoute: getCurrentUser()
    Note right of ExportRoute: any authenticated member can export —<br/>no admin-only gating, same rule as<br/>items export
    ExportRoute->>ExportSvc: exportFlashcardsFile(db)
    ExportSvc->>FlashcardsSvc: listFlashcards(db) — no limit
    Note right of FlashcardsSvc: called with no `limit`, so this<br/>returns every card unpaginated<br/>regardless of workspace size
    FlashcardsSvc->>DB: select * from flashcards (+ tags)
    DB-->>FlashcardsSvc: every flashcard row
    FlashcardsSvc-->>ExportSvc: flashcards[]
    ExportSvc->>ExportSvc: matter.stringify(card.back, { front, tags, source })<br/>per card, joined into one file
    ExportSvc-->>ExportRoute: file: string
    ExportRoute-->>Browser: 200 text/markdown<br/>Content-Disposition: attachment,<br/>filename="flashcards-export.md"

    opt any other (non-AppError) thrown error (api-errors.ts:74-95, withErrorHandling catch_clause)
        ExportRoute-->>Browser: 500 { error: { code: "INTERNAL",<br/>message: "Something went wrong. Please try again.", requestId } }
        Note right of ExportRoute: withErrorHandling wraps the whole handler — an<br/>AppError throw gets its own status/code/message<br/>(as in the import diagram above); anything else<br/>falls back to this generic 500.
    end
```

`gray-matter`'s `stringify` always emits a trailing newline before the next
entry's `---`, so simply joining every entry's output with no extra
separator round-trips cleanly back through `splitFrontmatterEntries` — an
exported file re-imports as the same number of entries it was exported
with (modulo any further edits).
