import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import { FrontmatterSplitError, splitFrontmatterEntries } from "@/lib/frontmatter-file";

const SINGLE_ENTRY = `---
front: What is the capital of France?
tags:
  - geography
source: https://example.com/geo
---

Paris.
`;

function threeEntryFixture(): string {
  return [
    "---",
    "front: Entry one?",
    "tags:",
    "  - one",
    "source: https://example.com/1",
    "---",
    "",
    "Answer one.",
    "",
    "",
    "---",
    "front: Entry two?",
    "tags:",
    "  - two",
    "source: https://example.com/2",
    "---",
    "",
    "Answer two,",
    "with a second line.",
    "",
    "",
    "---",
    "front: Entry three?",
    "tags: []",
    "source: https://example.com/3",
    "---",
    "",
    "Answer three.",
    "",
  ].join("\n");
}

describe("splitFrontmatterEntries", () => {
  it("splits a single-entry file into exactly one chunk", () => {
    const chunks = splitFrontmatterEntries(SINGLE_ENTRY);
    expect(chunks).toHaveLength(1);
  });

  it("splits an N-entry file into exactly N chunks in file order", () => {
    const chunks = splitFrontmatterEntries(threeEntryFixture());
    expect(chunks).toHaveLength(3);

    const fronts = chunks.map((chunk) => matter(`${chunk.frontmatterBlock}\n${chunk.body}`).data.front);
    expect(fronts).toEqual(["Entry one?", "Entry two?", "Entry three?"]);
  });

  it("each chunk's frontmatter block + body parses via gray-matter to the same fields/body a hand-written single-entry file would", () => {
    const [chunk] = splitFrontmatterEntries(SINGLE_ENTRY);
    const reconstructed = matter(`${chunk.frontmatterBlock}\n${chunk.body}`);
    const handWritten = matter(SINGLE_ENTRY);

    expect(reconstructed.data).toEqual(handWritten.data);
    expect(reconstructed.content.trim()).toBe(handWritten.content.trim());
    expect(reconstructed.content.trim()).toBe("Paris.");
  });

  it("preserves multi-line bodies within a single chunk", () => {
    const chunks = splitFrontmatterEntries(threeEntryFixture());
    expect(chunks[1].body).toBe("Answer two,\nwith a second line.");
  });

  it("does not mistake a markdown horizontal rule inside a body for the next entry's delimiter", () => {
    const raw = [
      "---",
      "front: Entry with a horizontal rule?",
      "source: https://example.com/1",
      "---",
      "",
      "Intro.",
      "",
      "---",
      "",
      "More content after the rule.",
      "",
      "",
      "---",
      "front: Second entry?",
      "source: https://example.com/2",
      "---",
      "",
      "Second body.",
      "",
    ].join("\n");

    const chunks = splitFrontmatterEntries(raw);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].body).toBe("Intro.\n\n---\n\nMore content after the rule.");
    expect(matter(`${chunks[1].frontmatterBlock}\n${chunks[1].body}`).data.front).toBe("Second entry?");
    expect(chunks[1].body).toBe("Second body.");
  });

  it("rejects a body with no leading frontmatter block", () => {
    expect(() => splitFrontmatterEntries("Just some markdown with no frontmatter at all.")).toThrow(
      FrontmatterSplitError,
    );
  });

  it("rejects an unterminated frontmatter block", () => {
    const raw = ["---", "front: Unterminated?", "source: https://example.com", "", "No closing delimiter."].join(
      "\n",
    );
    expect(() => splitFrontmatterEntries(raw)).toThrow(FrontmatterSplitError);
  });

  it("rejects an empty file", () => {
    expect(() => splitFrontmatterEntries("")).toThrow(FrontmatterSplitError);
  });
});
