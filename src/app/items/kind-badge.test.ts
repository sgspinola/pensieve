import { BookOpen, FileText, Link, Wrench } from "lucide-react";
import { describe, expect, it } from "vitest";
import { kindBadgeLabel, kindIcon } from "./kind-badge";

describe("kindBadgeLabel", () => {
  it("labels a link item", () => {
    expect(kindBadgeLabel("link")).toBe("Link");
  });

  it("labels a tool item", () => {
    expect(kindBadgeLabel("tool")).toBe("Tool");
  });

  it("labels an article item", () => {
    expect(kindBadgeLabel("article")).toBe("Article");
  });

  it("labels a wiki page item as WIKI, distinct from article", () => {
    expect(kindBadgeLabel("page")).toBe("Wiki");
  });
});

describe("kindIcon", () => {
  it("maps each kind to a distinct icon", () => {
    expect(kindIcon("link")).toBe(Link);
    expect(kindIcon("tool")).toBe(Wrench);
    expect(kindIcon("article")).toBe(FileText);
    expect(kindIcon("page")).toBe(BookOpen);
  });
});
