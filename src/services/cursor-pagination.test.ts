import { is, SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { items } from "@/db/schema";
import { ValidationError } from "@/services/errors";
import { createCursorPagination } from "./cursor-pagination";

/**
 * Shared keyset-cursor implementation behind items.ts's and flashcards.ts's
 * `listXxx` pagination — both previously hand-rolled an identical
 * encode/decode/orderKey/afterCursor set, differing only in which table's
 * columns they bound to. `createCursorPagination` is the one implementation,
 * bound per entity via its (dateColumn, idColumn) arguments.
 */
describe("createCursorPagination", () => {
  const pagination = createCursorPagination(items.createdAt, items.id);

  describe("encode/decode", () => {
    it("round-trips a cursor through encode then decode", () => {
      const cursor = { createdAt: "2024-01-01T00:00:00.000Z", id: "abc-123" };
      expect(pagination.decode(pagination.encode(cursor))).toEqual(cursor);
    });

    it("rejects a cursor that isn't valid base64url/JSON", () => {
      expect(() => pagination.decode("not-a-real-cursor")).toThrow(ValidationError);
    });

    it("rejects a decoded payload missing required fields", () => {
      const raw = Buffer.from(JSON.stringify({ id: "abc-123" }), "utf8").toString("base64url");
      expect(() => pagination.decode(raw)).toThrow(ValidationError);
    });

    it("rejects a decoded payload with an unparseable createdAt", () => {
      const raw = Buffer.from(JSON.stringify({ createdAt: "not-a-date", id: "abc-123" }), "utf8").toString(
        "base64url",
      );
      expect(() => pagination.decode(raw)).toThrow(ValidationError);
    });
  });

  describe("orderKey/afterCursor", () => {
    it("orderKey returns a SQL fragment", () => {
      expect(is(pagination.orderKey(), SQL)).toBe(true);
    });

    it("afterCursor returns a SQL fragment", () => {
      const cursor = { createdAt: "2024-01-01T00:00:00.000Z", id: "abc-123" };
      expect(is(pagination.afterCursor(cursor), SQL)).toBe(true);
    });
  });
});
