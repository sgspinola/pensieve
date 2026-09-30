# Wiki Article Management

A wiki article is not a separate resource — it's a row in `items` with
`kind: "page"` (see [Database schema](/architecture/database-schema)). There
is no `/api/wiki/*` route; create/edit/reparent/delete all go through the
same generic items endpoints as links/tools/articles
(`src/app/api/items/route.ts` POST, `src/app/api/items/[id]/route.ts`
PATCH/DELETE), with `kind: "page"`-specific behavior branching inside
`src/services/items/items.ts` and `src/services/items/wiki.ts`.

`src/services/items/wiki.ts:1-17` documents the module's own shape: it's
mostly pure, DB-free tree helpers (`buildArticleTree`, `getAncestorChain`,
`wouldCreateCycle`) that `items.ts` composes with real queries, plus one
exception — `deleteArticleWithChildren`, the single DB-touching export,
kept here because it's the one place that composes `buildArticleTree` with
an actual delete.

## Create and edit

Create (`POST /api/items`) and edit (`PATCH /api/items/[id]`) reuse the exact
same code paths as any other item kind — see
[Item lifecycle](/flows/item-lifecycle) for the full create/edit diagram.
Two `kind: "page"`-specific rules apply inside `createItem`
(`src/services/items/items.ts:113-168`) and `updateItem`
(`items.ts:418-471`):

- A wiki page never triggers the metadata-fetch prefill that link/tool/
  article items get — `createItem`'s metadata branch is explicitly gated on
  `input.kind !== "page"` (`items.ts:126`), since a page has no URL to fetch
  from. Its `title`/`content` are always taken as given.
- `parentId` is rejected outright for any kind other than `"page"` —
  `createItem` throws `ValidationError("parentId is only valid for pages")`
  (`items.ts:133-135`) and `updateItem` throws the same
  (`items.ts:441-443`) — so a link/tool/article can never be slotted into
  the wiki tree.
- Editing a page's fields (title, content, tags, etc. — not `parentId`) skips
  the usual creator-or-admin check entirely: `updateItem` only calls
  `assertCanModify` when `item.kind !== "page"` (`items.ts:427-429`). Any
  authenticated member can edit any page's content. This is a deliberate
  asymmetry from link/tool/article items (which stay creator-or-admin) and
  from deleting a page (which is still permission-gated — see below):
  wiki pages are treated as shared, collaboratively-editable documents.

## Reparent, with cycle prevention

```mermaid
sequenceDiagram
    actor Browser
    participant Route as PATCH /api/items/[id]
    participant ItemsSvc as services/items/items.ts
    participant DB as Postgres (via Drizzle)

    Browser->>Route: PATCH { parentId: newParentId }
    Route->>Route: getCurrentUser()
    Route->>ItemsSvc: updateItem(db, user, id, { parentId })

    ItemsSvc->>DB: getItem(id) — select * from items where id = :id
    alt item not found (items.ts:375-380)
        ItemsSvc-->>Route: throw NotFoundError("Item not found")
        Route-->>Browser: 404 { error: { code: "NOT_FOUND",<br/>message: "Item not found", requestId } }
    else item found, not a page (items.ts:440-443)
        ItemsSvc-->>Route: throw ValidationError("parentId is only valid for pages")
        Route-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "parentId is only valid for pages", requestId } }
    else item is a page, newParentId not null (items.ts:445-457)
        ItemsSvc->>DB: assertValidParent(newParentId) —<br/>select * from items where id = :newParentId
        alt parent row missing or not kind="page" (items.ts:89-94)
            ItemsSvc-->>Route: throw ValidationError("parentId must reference an existing page")
            Route-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "parentId must reference an existing page", requestId } }
        else parent is a valid page, and newParentId !== item.parentId
            ItemsSvc->>DB: select id, parent_id, title from items where kind = 'page'
            DB-->>ItemsSvc: every page row
            ItemsSvc->>ItemsSvc: wouldCreateCycle(articles, id, newParentId)
            Note right of ItemsSvc: true if newParentId === id, or if id<br/>appears in newParentId's own ancestor<br/>chain (wiki.ts:108-120) — walks<br/>getAncestorChain(newParentId) up to root
            alt would create a cycle (items.ts:453-455)
                ItemsSvc-->>Route: throw ValidationError("This would create a cycle in the article hierarchy")
                Route-->>Browser: 400 { error: { code: "VALIDATION",<br/>message: "This would create a cycle in the article hierarchy", requestId } }
            else safe to reparent
                ItemsSvc->>DB: update items set parent_id = :newParentId,<br/>updated_at = now() where id = :id
                DB-->>ItemsSvc: updated row
                ItemsSvc-->>Route: item
                Route-->>Browser: 200 { item }
            end
        end
    end
```

`wouldCreateCycle` (`src/services/items/wiki.ts:108-120`) is pure and
DB-free: given the flat list of every page row, it returns `true` in two
cases — the trivial one (`candidateParentId === articleId`, i.e. an article
can't be its own parent) and the transitive one, where it walks
`candidateParentId`'s ancestor chain via `getAncestorChain`
(`wiki.ts:81-99`) and checks whether `articleId` shows up anywhere in it. If
either is true, re-parenting would turn a tree into a cycle (unreachable
from the root, and `buildArticleTree` would silently orphan the whole
subtree as a phantom root — see `wiki.ts:37-44`'s own note on dangling
`parentId` references), so `updateItem` rejects the request with a `400`
before ever writing to the database. Note the query only re-fetches and
re-checks the full page set when `newParentId !== item.parentId`
(`items.ts:447`) — a PATCH that includes `parentId` but sets it to its
current value is a no-op for cycle-checking purposes and skips straight to
the update.

## Delete: promote vs. cascade

`DELETE /api/items/[id]?cascade=true` (`src/app/api/items/[id]/route.ts:41-52`)
reads the `cascade` query param and passes it straight through to
`deleteItem` (`items.ts:473-495`), which — for `kind: "page"` items only —
delegates the entire operation, **including its own permission check**, to
`deleteArticleWithChildren` (`wiki.ts:165-220`). This is the one place in
the wiki flow where the two modes have genuinely different authorization
rules, not just different SQL:

```mermaid
sequenceDiagram
    actor Browser
    participant Route as DELETE /api/items/[id]?cascade=
    participant ItemsSvc as services/items/items.ts
    participant WikiSvc as services/items/wiki.ts
    participant TagsSvc as services/tags/tags.ts
    participant DB as Postgres (via Drizzle)

    Browser->>Route: DELETE /api/items/:id?cascade=true|false
    Route->>Route: getCurrentUser()
    Route->>ItemsSvc: deleteItem(db, user, id, { cascade })
    ItemsSvc->>DB: getItem(id)
    alt item not found (items.ts:375-380, wiki.ts:171-174)
        ItemsSvc-->>Route: throw NotFoundError("Item not found")
        Route-->>Browser: 404 { error: { code: "NOT_FOUND",<br/>message: "Item not found", requestId } }
    else item.kind !== "page"
        Note right of ItemsSvc: link/tool/article: cascade is ignored,<br/>single-item delete, creator-or-admin<br/>(assertCanModify, items.ts:489) — not shown here
    else item.kind === "page"
        ItemsSvc->>WikiSvc: deleteArticleWithChildren(db, actor, id, { cascade })
        WikiSvc->>DB: select * from items where id = :id (re-fetch)

        alt cascade === true (wiki.ts:176-203)
            alt actor.role !== "admin" (wiki.ts:177-179)
                WikiSvc-->>ItemsSvc: throw UnauthorizedError("Only an admin can delete an article and its descendants")
                ItemsSvc-->>Route: rethrow
                Route-->>Browser: 401 { error: { code: "UNAUTHORIZED",<br/>message: "Only an admin can delete an article and its descendants", requestId } }
            else actor is admin
                WikiSvc->>DB: select id, parent_id, title from items where kind = 'page'
                WikiSvc->>WikiSvc: buildArticleTree(allArticles)<br/>find subtree rooted at id<br/>flattenSubtreeIds()<br/>(wiki.ts:187-189) — article + every<br/>descendant at any depth
                WikiSvc->>DB: db.transaction: select tag_id from item_tags<br/>where item_id in (idsToDelete)<br/>delete from items where id in (idsToDelete)
                DB-->>WikiSvc: deleted tag-link rows
                WikiSvc->>TagsSvc: pruneUnusedTags(deletedTagRows.tagIds)
                Note right of TagsSvc: deletes any tag row now<br/>referenced by zero items —<br/>item_tags rows cascade with<br/>the item FK, but tags rows don't
                WikiSvc-->>ItemsSvc: void
                ItemsSvc-->>Route: void
                Route-->>Browser: 204
            end
        else cascade falsy (default) — promote children (wiki.ts:206-219)
            alt !canModifyItem(actor, article) — not creator, not admin (wiki.ts:206-208)
                WikiSvc-->>ItemsSvc: throw UnauthorizedError("You do not have permission to modify this item")
                ItemsSvc-->>Route: rethrow
                Route-->>Browser: 401 { error: { code: "UNAUTHORIZED",<br/>message: "You do not have permission to modify this item", requestId } }
            else creator or admin
                WikiSvc->>DB: db.transaction: select tag_id from item_tags<br/>where item_id = :id<br/>update items set parent_id = article.parent_id<br/>where parent_id = :id<br/>delete from items where id = :id
                Note right of DB: direct children are re-parented to<br/>*the deleted article's own parent*<br/>(one level up), not orphaned to<br/>top-level — a nested delete doesn't<br/>dump children to root (wiki.ts:151-154)
                DB-->>WikiSvc: deleted tag-link rows
                WikiSvc->>TagsSvc: pruneUnusedTags(deletedTagRows.tagIds)
                WikiSvc-->>ItemsSvc: void
                ItemsSvc-->>Route: void
                Route-->>Browser: 204
            end
        end
    end
```

**The two modes are mutually exclusive and asymmetric in who's allowed to
use them** (`wiki.ts:147-163`'s doc comment spells this out explicitly):

| Mode | Trigger | Scope | Who |
|---|---|---|---|
| Promote (default) | `cascade` omitted/false | Article only; direct children re-parented one level up to *the article's own parent* | Creator or admin (`canModifyItem`) |
| Cascade | `cascade: true` | Article **and every descendant at any depth**, deleted together | Admin only |

Both modes run inside a single `db.transaction` (`wiki.ts:191-198` and
`:210-215`) so a delete can't leave a half-updated tree (e.g. children
re-parented but the article itself still present) if something fails
partway through. Both also call `pruneUnusedTags` afterward on whatever tag
IDs were freed up — `item_tags` join rows cascade-delete with the item via
its FK, but the `tags` row itself has no such cascade, so a tag now
referenced by zero items would otherwise leak.
