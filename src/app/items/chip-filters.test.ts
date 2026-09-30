import { describe, expect, it } from "vitest";
import type { CreatableItemKind } from "@/services/items/items";
import { dropStaleTags, parseTagsParam, serializeTagsParam, toggleKindChip, toggleTagChip } from "./chip-filters";

describe("parseTagsParam", () => {
  it("normalizes a single repeated-param value into a one-element list", () => {
    expect(parseTagsParam("ai")).toEqual(["ai"]);
  });

  it("passes through multiple repeated-param values as-is", () => {
    expect(parseTagsParam(["ai", "ml"])).toEqual(["ai", "ml"]);
  });

  it("trims whitespace around each tag", () => {
    expect(parseTagsParam([" ai ", " ml "])).toEqual(["ai", "ml"]);
  });

  it("drops empty/whitespace-only values", () => {
    expect(parseTagsParam(["ai", "  ", "ml", ""])).toEqual(["ai", "ml"]);
  });

  it("dedupes repeated tag names", () => {
    expect(parseTagsParam(["ai", "ai", "ml"])).toEqual(["ai", "ml"]);
  });

  it("preserves a tag name containing a comma rather than splitting it", () => {
    expect(parseTagsParam(["foo,bar"])).toEqual(["foo,bar"]);
  });

  it("returns an empty array for undefined", () => {
    expect(parseTagsParam(undefined)).toEqual([]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseTagsParam("")).toEqual([]);
  });
});

describe("serializeTagsParam", () => {
  it("passes through tag names untouched, including ones containing commas", () => {
    expect(serializeTagsParam(["ai", "ml", "foo,bar"])).toEqual(["ai", "ml", "foo,bar"]);
  });

  it("returns an empty array for an empty list, so callers append nothing", () => {
    expect(serializeTagsParam([])).toEqual([]);
  });
});

describe("toggleKindChip", () => {
  it("adds a kind not yet selected", () => {
    expect(toggleKindChip([], "link")).toEqual(["link"]);
  });

  it("appends to existing selected kinds, preserving order", () => {
    expect(toggleKindChip(["link"], "tool")).toEqual(["link", "tool"]);
  });

  it("removes a kind that's already selected", () => {
    expect(toggleKindChip(["link", "tool"], "link")).toEqual(["tool"]);
  });

  it("removing one kind leaves the others untouched", () => {
    expect(toggleKindChip(["link", "tool", "article"], "tool")).toEqual(["link", "article"]);
  });

  it("does not mutate the input array", () => {
    const input: CreatableItemKind[] = ["link"];
    toggleKindChip(input, "tool");
    expect(input).toEqual(["link"]);
  });
});

describe("dropStaleTags", () => {
  it("returns the selection unchanged when every selected tag still exists", () => {
    expect(dropStaleTags(["ai", "ml"], ["ai", "ml", "web"])).toEqual(["ai", "ml"]);
  });

  it("drops a selected tag that no longer exists, keeping the rest selected", () => {
    expect(dropStaleTags(["ai", "vanished", "ml"], ["ai", "ml"])).toEqual(["ai", "ml"]);
  });

  it("drops every selected tag when none of them still exist, returning an empty selection", () => {
    expect(dropStaleTags(["gone1", "gone2"], ["ai", "ml"])).toEqual([]);
  });

  it("returns an empty array unchanged when nothing is selected", () => {
    expect(dropStaleTags([], ["ai", "ml"])).toEqual([]);
  });

  it("preserves selection order", () => {
    expect(dropStaleTags(["ml", "ai"], ["ai", "ml"])).toEqual(["ml", "ai"]);
  });

  it("does not mutate the input array", () => {
    const input = ["ai", "vanished"];
    dropStaleTags(input, ["ai"]);
    expect(input).toEqual(["ai", "vanished"]);
  });
});

describe("toggleTagChip", () => {
  it("adds a tag not yet selected", () => {
    expect(toggleTagChip([], "ai")).toEqual(["ai"]);
  });

  it("appends to existing selected tags, preserving order", () => {
    expect(toggleTagChip(["ai"], "ml")).toEqual(["ai", "ml"]);
  });

  it("removes a tag that's already selected", () => {
    expect(toggleTagChip(["ai", "ml"], "ai")).toEqual(["ml"]);
  });

  it("does not mutate the input array", () => {
    const input = ["ai"];
    toggleTagChip(input, "ml");
    expect(input).toEqual(["ai"]);
  });
});
