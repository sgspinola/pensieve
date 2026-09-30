import { type AnyColumn, sql, type SQL } from "drizzle-orm";
import { ValidationError } from "@/services/errors";

/**
 * Keyset cursor payload: the last row's (createdAt, id) from the page just
 * returned. `id` is a tie-breaker, not just a serialization nicety —
 * `createdAt` alone isn't guaranteed unique (e.g. a batch import writing
 * several rows within the same millisecond), so without it two rows could
 * tie and one could be skipped or repeated across pages.
 */
export interface Cursor {
  createdAt: string;
  id: string;
}

export interface CursorPagination {
  encode(cursor: Cursor): string;
  decode(raw: string): Cursor;
  /**
   * `dateColumn` truncated to millisecond precision — the precision a JS
   * `Date` (and therefore a round-tripped cursor) can actually hold. Used
   * for both `ORDER BY` and `afterCursor` below so the two agree exactly:
   * comparing the column's full microsecond-precision value against a
   * millisecond-truncated cursor would make the cursor's own row spuriously
   * satisfy `dateColumn > cursor` (its unrounded value is later than the
   * rounded one handed back), duplicating it into the next page.
   */
  orderKey(): SQL;
  /**
   * Keyset predicate for "rows strictly after this cursor" under
   * `ORDER BY orderKey() DESC, idColumn DESC` (newest first): an earlier
   * truncated date, or the same truncated date with a smaller id as the
   * tie-break. Anchored to the last row actually seen rather than a row
   * count, so it's not thrown off by rows added mid-session (unlike an
   * offset) — a brand-new row lands ahead of the cursor, in a page the
   * caller hasn't asked for yet, rather than being skipped into or
   * duplicated across pages.
   */
  afterCursor(cursor: Cursor): SQL;
}

/**
 * Builds a keyset-cursor implementation bound to one entity's `(dateColumn,
 * idColumn)` pair — the shared logic behind items.ts's and flashcards.ts's
 * `listXxx` pagination, which previously each hand-rolled an identical copy
 * differing only in which table's columns they referenced.
 */
export function createCursorPagination(dateColumn: AnyColumn, idColumn: AnyColumn): CursorPagination {
  function orderKey(): SQL {
    return sql`date_trunc('milliseconds', ${dateColumn})`;
  }

  return {
    encode(cursor: Cursor): string {
      return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
    },

    decode(raw: string): Cursor {
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
      } catch {
        throw new ValidationError("Invalid pagination cursor");
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof (parsed as Cursor).createdAt !== "string" ||
        typeof (parsed as Cursor).id !== "string" ||
        Number.isNaN(Date.parse((parsed as Cursor).createdAt))
      ) {
        throw new ValidationError("Invalid pagination cursor");
      }
      return parsed as Cursor;
    },

    orderKey,

    afterCursor(cursor: Cursor): SQL {
      // Bound as a string with an explicit cast, not a JS Date: postgres.js's
      // driver-level type round trip for a raw (non-column-typed)
      // `timestamptz` placeholder mishandles a bound Date value here (throws
      // re-encoding it once the server reports its real type) — passing the
      // already-validated ISO string sidesteps that.
      const key = orderKey();
      return sql`(${key} < ${cursor.createdAt}::timestamptz or (${key} = ${cursor.createdAt}::timestamptz and ${idColumn} < ${cursor.id}))`;
    },
  };
}
