/**
 * Live tag-search filter for the study tag-selection screen. Case-insensitive
 * substring match against tag names; an empty query matches everything
 * (`"".includes` behavior on any string is always true, so no special case
 * is needed for "no filter yet").
 */
export function filterTagsByQuery(tags: string[], query: string): string[] {
  const needle = query.toLowerCase();
  return tags.filter((tag) => tag.toLowerCase().includes(needle));
}
