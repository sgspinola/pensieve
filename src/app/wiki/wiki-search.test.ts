import { describe, expect, it } from "vitest";
import type { ArticleTreeNode } from "@/services/items/wiki";
import { articleMatchesSearch, filterArticleTree, type SearchableArticle } from "./wiki-search";

describe("articleMatchesSearch", () => {
  it("matches an exact title (case-insensitive)", () => {
    expect(articleMatchesSearch({ title: "Onboarding Guide", content: "" }, "Onboarding Guide")).toBe(true);
  });

  it("matches a partial title, case-insensitively", () => {
    expect(articleMatchesSearch({ title: "Onboarding Guide", content: "" }, "onboard")).toBe(true);
  });

  it("matches by content when the title doesn't match", () => {
    expect(
      articleMatchesSearch({ title: "Release Notes", content: "Remember to rotate the API keys." }, "rotate"),
    ).toBe(true);
  });

  it("matches by content case-insensitively", () => {
    expect(
      articleMatchesSearch({ title: "Release Notes", content: "Remember to ROTATE the API keys." }, "rotate"),
    ).toBe(true);
  });

  it("returns false when neither title nor content matches", () => {
    expect(articleMatchesSearch({ title: "Release Notes", content: "Rotate the API keys." }, "onboarding")).toBe(
      false,
    );
  });

  it("treats a null content as empty rather than matching or throwing", () => {
    expect(articleMatchesSearch({ title: "Release Notes", content: null }, "notes")).toBe(true);
    expect(articleMatchesSearch({ title: "Release Notes", content: null }, "rotate")).toBe(false);
  });

  it("returns true for an empty query", () => {
    expect(articleMatchesSearch({ title: "Release Notes", content: "Rotate the API keys." }, "")).toBe(true);
  });

  it("returns true for a whitespace-only query", () => {
    expect(articleMatchesSearch({ title: "Release Notes", content: "Rotate the API keys." }, "   ")).toBe(true);
  });
});

type Article = SearchableArticle;

function node(
  overrides: Partial<Article> & { id: string; title: string },
  children: ArticleTreeNode<Article>[] = [],
): ArticleTreeNode<Article> {
  return { parentId: null, content: null, ...overrides, children };
}

describe("filterArticleTree", () => {
  const tree: ArticleTreeNode<Article>[] = [
    node(
      { id: "onboarding", title: "Onboarding Guide", content: "Welcome to the team." },
      [
        node({ id: "setup", title: "Dev Environment Setup", parentId: "onboarding", content: "Install Node." }),
        node({
          id: "keys",
          title: "Access",
          parentId: "onboarding",
          content: "Remember to rotate the API keys quarterly.",
        }),
      ],
    ),
    node({ id: "roadmap", title: "Roadmap", content: "Q3 priorities." }),
  ];

  it("finds an article by an exact/partial title match", () => {
    const results = filterArticleTree(tree, "roadmap");
    expect(results.map((a) => a.id)).toEqual(["roadmap"]);
  });

  it("matches titles case-insensitively", () => {
    const results = filterArticleTree(tree, "ROADMAP");
    expect(results.map((a) => a.id)).toEqual(["roadmap"]);
  });

  it("finds an article whose title doesn't match but whose content does", () => {
    const results = filterArticleTree(tree, "rotate");
    expect(results.map((a) => a.id)).toEqual(["keys"]);
  });

  it("finds nested matches at any depth, flattened out of the tree shape", () => {
    const results = filterArticleTree(tree, "onboarding");
    expect(results.map((a) => a.id)).toEqual(["onboarding"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterArticleTree(tree, "nonexistent-term")).toEqual([]);
  });

  it("returns every article, flattened, for an empty query", () => {
    const results = filterArticleTree(tree, "");
    expect(results.map((a) => a.id).sort()).toEqual(["keys", "onboarding", "roadmap", "setup"].sort());
  });

  it("returns every article, flattened, for a whitespace-only query", () => {
    const results = filterArticleTree(tree, "   ");
    expect(results.map((a) => a.id).sort()).toEqual(["keys", "onboarding", "roadmap", "setup"].sort());
  });
});
