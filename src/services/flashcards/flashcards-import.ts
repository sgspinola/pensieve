import matter from "gray-matter";
import { sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { flashcards } from "@/db/schema";
import { sha256Hex } from "@/lib/crypto";
import { FrontmatterSplitError, splitFrontmatterEntries } from "@/lib/frontmatter-file";
import { isStringArray } from "@/lib/request-fields";
import { ValidationError } from "@/services/errors";
import { normalizeTagNames, setFlashcardTags } from "@/services/tags/tags";
import { hasTags } from "@/services/tags/validation";

export interface ParsedFlashcardEntry {
  front: string;
  tags: string[];
  source: string;
  back: string;
}

/**
 * Parses a raw multi-entry file (ticket 01's splitter, then `gray-matter`
 * per chunk) into flashcard entries. All-or-nothing: any chunk that fails
 * to split, or whose entry has an empty `front`/`source`/answer body, or
 * (ticket 04) whose `tags` is missing/empty/all-blank once normalized,
 * throws ValidationError for the whole file — there is no partial result to
 * hand back, matching the "reject the whole file" import rule.
 */
export function parseFlashcardsImportFile(raw: string): ParsedFlashcardEntry[] {
  let chunks;
  try {
    chunks = splitFrontmatterEntries(raw);
  } catch (err) {
    if (err instanceof FrontmatterSplitError) {
      throw new ValidationError(`Could not parse the file: ${err.message}`);
    }
    throw err;
  }

  return chunks.map((chunk, index) => {
    const { data, content } = matter(`${chunk.frontmatterBlock}\n${chunk.body}`);

    const front = typeof data.front === "string" ? data.front.trim() : "";
    const source = typeof data.source === "string" ? data.source.trim() : "";
    const back = content.trim();

    if (!front) throw new ValidationError(`Entry ${index + 1}: missing "front"`);
    if (!source) throw new ValidationError(`Entry ${index + 1}: missing "source"`);
    if (!back) throw new ValidationError(`Entry ${index + 1}: empty answer body`);
    if (data.tags !== undefined && !isStringArray(data.tags)) {
      throw new ValidationError(`Entry ${index + 1}: "tags" must be a list of strings`);
    }
    const tags = normalizeTagNames(data.tags ?? []);
    if (!hasTags(tags)) {
      throw new ValidationError(`Entry ${index + 1}: missing "tags" in frontmatter (at least one tag is required)`);
    }

    return { front, tags, source, back };
  });
}

/**
 * A two-entry sample file in the exact format the import flow expects,
 * downloadable from the modal's Flashcards -> Import step (ticket 06) so a
 * member has a working starting point without guessing the shape. Both
 * `front` and `back` are rendered through `MarkdownBlock` (see
 * `FlashcardRow.tsx`/`Flashcard.tsx`), so `back` in particular leans on
 * headings, emphasis, lists, a blockquote, and both inline and fenced code
 * to show the format is fully supported, not just plain text.
 */
export function buildFlashcardImportSample(): string {
  return [
    matter.stringify(
      [
        "## Short answer",
        "",
        "**TCP** (Transmission Control Protocol) guarantees:",
        "",
        "- *Ordered* delivery of bytes",
        "- Reliable delivery via acknowledgment and retransmission",
        "- Congestion control",
        "",
        "```text",
        "Client -> SYN     -> Server",
        "Client <- SYN-ACK <- Server",
        "Client -> ACK     -> Server",
        "```",
        "",
        "> Contrast with `UDP`, which offers none of these guarantees.",
        "",
        "See also [RFC 9293](https://www.rfc-editor.org/rfc/rfc9293).",
      ].join("\n"),
      {
        front: "What does `TCP` guarantee that `UDP` does not?",
        tags: ["networking", "transport-layer"],
        source: "https://www.rfc-editor.org/rfc/rfc9293",
      },
    ),
    matter.stringify(
      [
        "### Short answer",
        "",
        "`UDP` (User Datagram Protocol) is a **connectionless**, unreliable transport used when latency matters more than guaranteed delivery:",
        "",
        "1. DNS lookups",
        "2. Live video/voice (RTP)",
        "3. Game state updates",
        "",
        "> No handshake, no retransmission, no ordering guarantee — *the application* is responsible for anything it needs on top.",
      ].join("\n"),
      {
        front: "What is `UDP` used for?",
        tags: ["networking", "transport-layer"],
        source: "https://www.rfc-editor.org/rfc/rfc8085",
      },
    ),
  ].join("");
}

export interface ImportFlashcardsResult {
  created: number;
  updated: number;
}

/**
 * Imports every entry in a raw multi-entry file (ticket 06), upserting on
 * `frontHash` (ticket 04's unique index): an entry whose trimmed `front`
 * matches an existing card updates that card's `back`/`source`/tags in
 * place; every other entry creates a new card. Both created and updated
 * cards are attributed to `creatorId` (the importing member), never to any
 * authorship implied by the file. Parsing happens up front and is
 * all-or-nothing (see parseFlashcardsImportFile) — nothing is written to
 * the database if any entry fails to parse or validate. The per-entry
 * writes below are wrapped in a single DB transaction too, so a failure
 * partway through the batch (e.g. a dropped connection) can't leave a
 * partial import committed either — "nothing partially committed" covers
 * every failure mode, not just parse-time validation.
 */
export async function importFlashcardsFile(
  db: Database,
  raw: string,
  creatorId: string,
): Promise<ImportFlashcardsResult> {
  const entries = parseFlashcardsImportFile(raw);

  return db.transaction(async (tx) => {
    let created = 0;
    let updated = 0;

    for (const entry of entries) {
      const [row] = await tx
        .insert(flashcards)
        .values({
          front: entry.front,
          back: entry.back,
          source: entry.source,
          frontHash: sha256Hex(entry.front),
          createdBy: creatorId,
        })
        .onConflictDoUpdate({
          target: flashcards.frontHash,
          set: { back: entry.back, source: entry.source, createdBy: creatorId, updatedAt: new Date() },
        })
        // The classic Postgres upsert idiom for "did this row get inserted
        // or updated": a fresh insert's xmax system column is 0, an
        // updated row's is the transaction id that just wrote it.
        .returning({ id: flashcards.id, inserted: sql<boolean>`(xmax = 0)` });

      if (row.inserted) {
        created++;
      } else {
        updated++;
      }

      await setFlashcardTags(tx, row.id, entry.tags);
    }

    return { created, updated };
  });
}
