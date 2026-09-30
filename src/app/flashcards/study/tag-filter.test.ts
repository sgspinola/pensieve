import { describe, expect, it } from "vitest";
import { filterTagsByQuery } from "./tag-filter";

describe("filterTagsByQuery", () => {
  it("returns every tag when the query is empty", () => {
    expect(filterTagsByQuery(["alpha", "beta"], "")).toEqual(["alpha", "beta"]);
  });

  it("matches tags containing the query, case-insensitively", () => {
    expect(filterTagsByQuery(["Networking", "Cryptography", "Unrelated"], "crypt")).toEqual(["Cryptography"]);
  });

  it("matches an uppercase query against lowercase tag names", () => {
    expect(filterTagsByQuery(["networking"], "NET")).toEqual(["networking"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterTagsByQuery(["alpha"], "zzz")).toEqual([]);
  });

  it("preserves the original tag order", () => {
    expect(filterTagsByQuery(["banana", "apple", "grape"], "a")).toEqual(["banana", "apple", "grape"]);
  });
});
