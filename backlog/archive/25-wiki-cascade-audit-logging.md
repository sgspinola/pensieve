# 25: Log every row affected by a wiki article cascade/promote delete

**What to build:** `deleteArticleWithChildren` (`src/services/items/wiki.ts`) performs real DB writes on *multiple* rows — every descendant item on a cascade delete, and a reparenting `UPDATE` on every direct child on a promote (non-cascade) delete — but none of those per-row writes get their own audit line. Only `deleteItem`'s single generic "Item deleted" (`src/services/items/items.ts`) covers the root id; every other row silently changes with zero audit trail. This closes that gap by logging one `logMutationSuccess` call per affected row: one "Item deleted" per id removed on cascade, and one "Item updated" (`changedFields: ["parentId"]`) per reparented child plus one "Item deleted" for the article itself on promote.

**Blocked by:** 24 (new log lines added here get full `userId`/`requestId` attribution for free via that ticket's context binding)

**Status:** done

**Completed:** on `feat/25-wiki-cascade-audit-logging`

**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/25

- [x] `deleteArticleWithChildren` in `src/services/items/wiki.ts` calls `logMutationSuccess(logger, "Item deleted", { entityKind: "items", entityId })` once per id removed in the cascade branch
- [x] `deleteArticleWithChildren`'s promote branch calls `logMutationSuccess(logger, "Item updated", { entityKind: "items", entityId: childId, changedFields: ["parentId"] })` for each reparented child, then logs the article's own deletion
- [x] Redundant success log removed from `deleteItem`'s page branch in `src/services/items/items.ts` (now owned by `deleteArticleWithChildren`); failure logging there is untouched — errors still bubble up and are logged exactly once
- [x] New tests in `src/services/items/wiki.test.ts` asserting per-row log counts: N+1 "Item deleted" calls for a cascade of N descendants, and M "Item updated" + 1 "Item deleted" calls for a promote of M children
- [x] Existing `src/services/items/items.test.ts` delete tests still pass with the redundant log call removed from the page branch
- [x] Manually verified: cascade-deleted a wiki article with a child through the real service layer and confirmed one "Item deleted" log line per removed row; promote-deleted an article with a child and confirmed one "Item updated" (`parentId`) line for the child plus one "Item deleted" for the article
