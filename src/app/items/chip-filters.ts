import type { CreatableItemKind } from "@/services/items/items";

/**
 * Parses the `?tags=` URL param into a list, trimmed and deduped,
 * preserving first-seen order. Takes one or many raw values — a repeated
 * query param (`?tags=ai&tags=ml`) comes back from Next as a string array,
 * a single occurrence as a bare string — rather than a single comma-joined
 * value, so a tag name that itself contains a comma round-trips intact
 * instead of splitting into two spurious tags.
 */
export function parseTagsParam(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const tag = raw.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

/**
 * Inverse of parseTagsParam: the values to append as repeated `tags` params
 * (e.g. via `URLSearchParams.append`), not a single joined string — so a tag
 * name containing a comma is preserved rather than corrupted.
 */
export function serializeTagsParam(tags: string[]): string[] {
  return parseTagsParam(tags);
}

/**
 * Kind chips were single-select as of ticket 04 (clicking the active kind
 * cleared it, clicking another replaced it, matching the dropdown behavior
 * they replaced). As of ticket 10 they're independently multi-selectable
 * like tag chips, so "links and tools, not articles" is a real state:
 * clicking toggles membership, other selected kinds are untouched.
 */
export function toggleKindChip(current: CreatableItemKind[], clicked: CreatableItemKind): CreatableItemKind[] {
  return current.includes(clicked) ? current.filter((kind) => kind !== clicked) : [...current, clicked];
}

/** Tag chips are independently multi-selectable: clicking toggles membership. */
export function toggleTagChip(current: string[], clicked: string): string[] {
  return current.includes(clicked) ? current.filter((tag) => tag !== clicked) : [...current, clicked];
}

/**
 * Drops any selected tag no longer present in `available` (the live tag
 * pool) — self-healing for a selected tag that's been pruned (its last
 * flashcard/item reference deleted) out from under an active filter, which
 * otherwise leaves the selection referencing a tag `TagCloud` can no longer
 * render a chip for (so nothing shows as active) while the list query still
 * silently filters by it (yielding zero matches with no visible reason why).
 * Deliberately doesn't touch a selected tag that still exists but currently
 * matches nothing — that's a legitimate empty-result state, not staleness.
 */
export function dropStaleTags(selected: string[], available: string[]): string[] {
  return selected.filter((tag) => available.includes(tag));
}
