# Item Lifecycle

Covers create, view, edit, and delete for a link/tool/article item (`kind`
one of `"link" | "tool" | "article"`), plus the metadata-autofetch preview
step create relies on. Wiki pages (`kind: "page"`) share the same
create/edit/delete routes but have their own hierarchy-specific rules —
see [Wiki article management](/flows/wiki-article-management). Routes
involved: `src/app/api/items/route.ts` (GET list / POST create),
`src/app/api/items/[id]/route.ts` (PATCH / DELETE), and
`src/app/api/items/metadata/route.ts` (POST, metadata preview).

## View: no API round trip

The items library (`src/app/page.tsx`) is a Server Component — it calls
`listItems(db, filters)` and `countItems(db, filters)`
(`src/app/page.tsx:52-55`) directly against the service layer, the same way
every page in this app avoids re-querying through its own API for
server-rendered data (see [System overview](/architecture/system-overview)'s
request-lifecycle diagram). There's no `GET /api/items/[id]` route at all —
a single item's fields are only ever fetched as part of the shared list.
`GET /api/items` (`src/app/api/items/route.ts:59-88`) exists purely for the
*client-side* half of the same view: `ItemsLibrary.tsx`'s infinite scroll
pages past the server-rendered first page by calling this route directly.

Ticket 19 replaced this route's ad hoc `?kind=`/`?limit=` handling with
shared Zod schemas (`itemKindFilterSchema`/`limitQuerySchema`,
`src/lib/query-schemas.ts`) run through `parseOrThrow`: a `?kind=` value
outside `link`/`tool`/`article`/`page` — previously silently dropped from
the filter via `.filter(isCreatableItemKind)` — and a non-integer or
out-of-range `?limit=` — previously silently clamped back to
`ITEMS_PAGE_SIZE` via the removed `parseLimitParam` — now both reject the
whole request with a `400 { error: { code: "VALIDATION", issues } }`
instead. `?query=`/`?tags=`/`?cursor=` are validated too
(`queryParamSchema`/`tagsQuerySchema`/`cursorParamSchema`), though none of
those three can actually reject anything: any string (or absence) is valid
input to each, and a malformed `?cursor=` is still only ever caught
downstream, at `listItems`'s decode step.

## Create, with metadata autofetch

```mermaid
sequenceDiagram
    actor Browser
    participant MetaRoute as POST /api/items/metadata
    participant MetaSvc as services/items/metadata.ts
    participant Route as POST /api/items
    participant ItemsSvc as services/items/items.ts
    participant DB as Postgres (via Drizzle)
    participant Origin as Target URL's server

    Note over Browser: Add-item form: user pastes a URL

    Browser->>MetaRoute: POST { url }
    alt url missing/blank/wrong-type (metadata/route.ts:17-18, via schema.ts + parseOrThrow in lib/validation.ts — ticket 17)
        MetaRoute-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "url is required", requestId, issues } }
    else url present but not a valid URL (metadata/route.ts:17-18, same schema)
        MetaRoute-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "url must be a valid URL", requestId, issues } }
    else url present and well-formed
        MetaRoute->>MetaRoute: getCurrentUser()
        MetaRoute->>MetaSvc: fetchUrlMetadata(url)
        MetaSvc->>Origin: fetch(url)
        alt fetch throws, or response not ok (metadata.ts:89-98)
            Origin-->>MetaSvc: network error / non-2xx
            MetaSvc-->>MetaRoute: { title: null, description: null }
        else response ok
            Origin-->>MetaSvc: html
            MetaSvc->>MetaSvc: parseHtmlMetadata(html) —<br/>og:title/og:description win,<br/>fall back to the title tag/meta description
            MetaSvc-->>MetaRoute: { title, description }
        end
        MetaRoute-->>Browser: 200 { title, description }
        Note over Browser: Form prefills title/description,<br/>user may edit either before submitting
    end

    Browser->>Route: POST { kind, url?, title?, content?, description?, notes?, tags?, parentId? }
    alt body fails createItemBodySchema (items/route.ts:95-96, via schema.ts + parseOrThrow in lib/validation.ts — ticket 17)
        Note right of Route: kind missing/invalid; kind=page with title<br/>and/or content missing/blank (both flagged<br/>at once if both are absent); kind!=page with<br/>url missing/blank/wrong-type; tags not<br/>string[]; description/notes/parentId/title<br/>(non-page) not a string or null
        Route-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "Validation failed", requestId, issues } }
    else body valid
        Route->>Route: getCurrentUser()
        Route->>ItemsSvc: createItem(db, { creatorId, kind, url, title, description, notes, tags, parentId })

        alt kind != page, url present, and (title or description omitted) (items.ts:126-130)
            Note right of ItemsSvc: Second, server-side metadata fetch —<br/>independent of the preview call above.<br/>The preview's result is never passed<br/>through or cached — if the client omits<br/>title/description, createItem re-fetches.
            ItemsSvc->>MetaSvc: fetchUrlMetadata(url)
            MetaSvc-->>ItemsSvc: { title, description } (or nulls on failure)
        end

        opt parentId provided (items.ts:132-139)
            alt kind != page
                ItemsSvc-->>Route: throw ValidationError("parentId is only valid for pages")
                Route-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "parentId is only valid for pages", requestId } }
            else kind == page and parentId != null
                ItemsSvc->>DB: assertValidParent — select * from items where id = :parentId
                alt parent missing or not kind=page
                    ItemsSvc-->>Route: throw ValidationError("parentId must reference an existing page")
                    Route-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "parentId must reference an existing page", requestId } }
                end
            end
        end

        alt resolved title is empty after trim (items.ts:144-147)
            Note right of ItemsSvc: Catches: explicit empty title, AND a<br/>failed/metadata-less fetch that never<br/>found a title — ticket 03 made this a<br/>hard requirement for every kind
            ItemsSvc-->>Route: throw ValidationError("title is required")
            Route-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "title is required", requestId } }
        else title resolved
            ItemsSvc->>DB: insert into items (kind, url, title, description,<br/>content, notes, created_by, parent_id) returning *
            DB-->>ItemsSvc: new row
            opt tags provided
                ItemsSvc->>DB: setItemTags(row.id, tags)
            end
            ItemsSvc-->>Route: item
            Route-->>Browser: 201 { item }
        end
    end
```

The metadata preview (`/api/items/metadata`) and the fetch `createItem`
itself performs (`items.ts:126-130`) are **two independent HTTP fetches of
the same URL** — the preview's parsed result is never threaded through to
the create request. If the client-side form leaves `title`/`description`
untouched from what the preview showed, it typically still omits them from
the POST body (rather than round-tripping the preview's exact values), so
`createItem` fetches the target URL a second time. Both fetches share the
same never-throws contract: `fetchUrlMetadata` (`metadata.ts:85-99`) always
resolves to `{ title: null, description: null }` on any failure — a bad
URL, a non-2xx response, or a network error — rather than rejecting, so a
broken link never blocks item creation; it just means the caller has to
supply a title by hand (enforced by the `title is required` check at
`items.ts:144-147`).

## Edit and delete

`PATCH /api/items/[id]` and `DELETE /api/items/[id]`
(`src/app/api/items/[id]/route.ts`) are thin — both just parse the request
and forward to the service layer, which is the sole enforcer of the
creator-or-admin permission rule (`canModifyItem`, `items.ts:389-391`) for
non-page kinds:

```mermaid
sequenceDiagram
    actor Browser
    participant Route as PATCH /api/items/[id]
    participant ItemsSvc as services/items/items.ts
    participant DB as Postgres (via Drizzle)

    Browser->>Route: PATCH { url?, title?, description?, notes?, content?, tags?, parentId? }
    alt id not a valid UUID (items/[id]/route.ts:27-28, request-fields.ts idParamSchema)
        Route-->>Browser: 400 { error: { code: "VALIDATION", issues } }
    else body fails updateItemBodySchema (items/[id]/route.ts:30-31, via schema.ts + parseOrThrow in lib/validation.ts — ticket 17)
        Note right of Route: kind present at all (even unchanged) is<br/>rejected — immutable; tags not string[];<br/>url/description/notes/content/parentId not<br/>a string or null; title present but not a string
        Route-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "Validation failed", requestId, issues } }
    else body valid
        Route->>Route: getCurrentUser()
        Route->>ItemsSvc: updateItem(db, user, id, updates)
        ItemsSvc->>DB: getItem(id)
        alt not found (items.ts:375-380)
            ItemsSvc-->>Route: throw NotFoundError("Item not found")
            Route-->>Browser: 404 { error: { code: "NOT_FOUND",<br/>message: "Item not found", requestId } }
        else item.kind != page and !canModifyItem(actor, item) (items.ts:427-429, :389-391)
            Note right of ItemsSvc: admin, or actor.id === item.createdBy —<br/>otherwise rejected. (Pages skip this<br/>check entirely — see Wiki article<br/>management.)
            ItemsSvc-->>Route: throw UnauthorizedError("You do not have<br/>permission to modify this item")
            Route-->>Browser: 401 { error: { code: "UNAUTHORIZED",<br/>message: "You do not have permission to modify this item", requestId } }
        else title provided but blank after trim (items.ts:436-438)
            ItemsSvc-->>Route: throw ValidationError("title is required")
            Route-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "title is required", requestId } }
        else valid
            ItemsSvc->>DB: update items set ...columnUpdates, updated_at = now()<br/>where id = :id returning *
            opt tags provided
                ItemsSvc->>DB: setItemTags(id, tags)
            end
            ItemsSvc-->>Route: item
            Route-->>Browser: 200 { item }
        end
    end
```

`DELETE /api/items/[id]` validates `id` as a UUID the same way (returning the
same `400 { error: { code: "VALIDATION", issues } }` before touching the
service layer) then follows the identical
found/branch-on-kind/`canModifyItem` shape (`items.ts:473-495`) — for a
non-page item it deletes the row, then calls `pruneUnusedTags` on whatever
tag IDs the deleted item's own `item_tags` rows referenced, so a tag with
zero remaining items doesn't linger. A `kind: "page"` delete instead
delegates entirely to `deleteArticleWithChildren`, whose promote/cascade
branching is its own diagram in
[Wiki article management](/flows/wiki-article-management).

Ticket 19 added the same fail-closed treatment to `?cascade=`: it's now
parsed by `cascadeQuerySchema` (`src/lib/query-schemas.ts`) via
`parseOrThrow` ahead of the id/kind checks above, so anything other than
`"true"`, `"false"`, or an absent param (still defaulting to `false`, same
as before) returns `400 { error: { code: "VALIDATION", issues: [{ field:
"", message: "cascade must be \"true\" or \"false\"" }] } }` instead of the
previous `searchParams.get("cascade") === "true"` check, which silently
treated any other value (a typo, `"1"`) as `false`.
