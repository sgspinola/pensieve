/**
 * Pure, I/O-free splitting of a raw file's text — containing any number of
 * `---`-delimited frontmatter blocks each followed by a markdown body,
 * concatenated one after another (the shape used by hand-authored
 * multi-entry flashcard files)
 * — into individual per-entry chunks. Each chunk's `frontmatterBlock` (the
 * two `---` delimiters plus the YAML between them) concatenated with its
 * `body` reconstructs a single-entry document parseable the normal way by
 * `gray-matter`, exactly like a hand-authored single-entry file.
 *
 * A deliberate prefactor (issue: batch-import-export-and-article-item-type,
 * ticket 01): the original single-entry-per-file parsing in the
 * (since removed) `scripts/import-flashcards.ts` only ever recognizes the first `---` block
 * in a file and treats everything after it — including further entries — as
 * one giant body, which is why a multi-entry file isn't actually importable
 * by that script today. This module replaces that assumption for every
 * caller that needs to parse multi-entry files (the flashcard `source`
 * backfill, and the flashcard/item import parsers).
 */

import matter from "gray-matter";

const DELIMITER_LINE = /^---\s*$/;

/** Thrown for input that can't be partitioned into complete entries. */
export class FrontmatterSplitError extends Error {}

export interface FrontmatterFileEntry {
  /** The raw `---\n<yaml>\n---` block, without the body. */
  frontmatterBlock: string;
  /** The raw markdown body following the closing delimiter, trimmed of surrounding blank lines. */
  body: string;
}

/**
 * True when the lines between a candidate pair of `---` delimiters parse as
 * a genuine frontmatter mapping (a non-null, non-array YAML object with at
 * least one key) rather than markdown body content. Used to tell a real
 * next-entry delimiter apart from a `---` that's just a markdown horizontal
 * rule sitting inside the current entry's body — a bare "---" line has no
 * special meaning in gray-matter's own YAML frontmatter, but a bulleted list
 * or a "key: value"-shaped line of prose can otherwise parse as valid (if
 * unintended) YAML, so this also rejects arrays/scalars, not just outright
 * YAML syntax errors.
 */
function looksLikeFrontmatterObject(yamlLines: string[]): boolean {
  try {
    const { data } = matter(`---\n${yamlLines.join("\n")}\n---\n`);
    return typeof data === "object" && data !== null && !Array.isArray(data) && Object.keys(data).length > 0;
  } catch {
    return false;
  }
}

/**
 * Splits `raw` into an ordered list of frontmatter+body chunks. A file with
 * a single entry (no trailing content after one `---`...`---` block) yields
 * exactly one chunk, so existing single-entry files remain valid input. A
 * bare `---` line inside a body (e.g. a markdown horizontal rule) is left in
 * place as body content rather than mistaken for the next entry's opening
 * delimiter — see `looksLikeFrontmatterObject`.
 *
 * Throws `FrontmatterSplitError` when the input can't be partitioned: the
 * file doesn't start with a `---` delimiter line, or the last frontmatter
 * block is left unterminated (an opening delimiter with no closing one
 * after it). This function doesn't decide all-or-nothing import behavior
 * itself — callers turn a thrown error into whatever rejection behavior
 * they need.
 */
export function splitFrontmatterEntries(raw: string): FrontmatterFileEntry[] {
  const lines = raw.split(/\r\n|\r|\n/);

  const firstContentLineIndex = lines.findIndex((line) => line.trim() !== "");
  if (firstContentLineIndex === -1 || !DELIMITER_LINE.test(lines[firstContentLineIndex])) {
    throw new FrontmatterSplitError('Expected the file to start with a frontmatter block delimited by "---" lines');
  }

  const delimiterIndexes: number[] = [];
  lines.forEach((line, index) => {
    if (DELIMITER_LINE.test(line)) delimiterIndexes.push(index);
  });

  const entries: FrontmatterFileEntry[] = [];
  let openIndex = firstContentLineIndex;

  while (true) {
    const closeIndex = delimiterIndexes.find((index) => index > openIndex);
    if (closeIndex === undefined) {
      throw new FrontmatterSplitError('Unterminated frontmatter block: found no closing "---" delimiter');
    }
    const frontmatterBlock = lines.slice(openIndex, closeIndex + 1).join("\n");

    // Scan forward for the next entry's real opening delimiter, skipping any
    // "---" that's actually body content (a horizontal rule, or one that
    // simply has no closing delimiter of its own left in the file).
    let nextOpenIndex: number | undefined;
    let bodyEndIndex = lines.length;
    for (const candidate of delimiterIndexes) {
      if (candidate <= closeIndex) continue;
      const candidateClose = delimiterIndexes.find((index) => index > candidate);
      if (candidateClose === undefined) continue;
      if (!looksLikeFrontmatterObject(lines.slice(candidate + 1, candidateClose))) continue;
      nextOpenIndex = candidate;
      bodyEndIndex = candidate;
      break;
    }

    const body = lines
      .slice(closeIndex + 1, bodyEndIndex)
      .join("\n")
      .trim();
    entries.push({ frontmatterBlock, body });

    if (nextOpenIndex === undefined) break;
    openIndex = nextOpenIndex;
  }

  return entries;
}
