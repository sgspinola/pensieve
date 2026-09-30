import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MarkdownPreview from "@uiw/react-markdown-preview/nohighlight";
import { describe, expect, it } from "vitest";
import { MARKDOWN_REHYPE_PLUGINS } from "./markdown-plugins";

/**
 * Exercises the real `@uiw/react-markdown-preview` component (the same one
 * `MarkdownBlock`/`MarkdownEditor` render) with the shared plugin list, via
 * `react-dom/server` — no browser/jsdom needed, since server rendering to a
 * static string is enough to inspect the resulting markup. This is the seam
 * ticket 21 asks for: proof that adding `rehype-sanitize` didn't regress
 * syntax highlighting, and that it does strip raw-HTML injection attempts.
 * It also locks in the schema extension added alongside it (see
 * `markdown-plugins.ts`) — the library's own heading anchor-link icon and
 * code-block copy button both inject markup that the default sanitize
 * schema doesn't recognize, and would otherwise be silently stripped.
 *
 * This belongs in Vitest, not an `e2e/` Playwright spec, despite touching a
 * React component: nothing here is hydration- or interaction-sensitive (no
 * client JS runs — `renderToStaticMarkup` never mounts, so effects/handlers
 * never fire), and this ticket didn't add or move any `"use client"`
 * boundary that could newly break on hydration. What's under test is a
 * deterministic mapping from a markdown string to an HTML string via the
 * shared plugin list, which is exactly the pure-function-shaped case
 * Vitest is for; a Playwright spec would only add browser-boot overhead
 * without covering anything more.
 */
function renderMarkdown(source: string): string {
  return renderToStaticMarkup(
    createElement(MarkdownPreview, { source, rehypePlugins: MARKDOWN_REHYPE_PLUGINS }),
  );
}

describe("MARKDOWN_REHYPE_PLUGINS", () => {
  it("still applies language-* classes for syntax highlighting", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```\n");
    expect(html).toContain('class="language-js"');
    expect(html).toContain("token keyword");
  });

  it("strips a raw <script> tag embedded in markdown", () => {
    const html = renderMarkdown("Attempt: <script>alert(1)</script> done");
    expect(html).not.toContain("<script");
  });

  it("strips an onerror attribute smuggled via embedded raw HTML", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("strips a javascript: URL from a markdown link", () => {
    const html = renderMarkdown("[link](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("keeps the heading anchor-link's id and href in sync (both clobber-prefixed)", () => {
    const html = renderMarkdown("# Heading One\n");
    expect(html).toContain('id="user-content-heading-one"');
    expect(html).toContain('href="#user-content-heading-one"');
  });

  it("keeps the code-block copy button's class and data-code attributes", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```\n");
    expect(html).toContain('class="copied"');
    expect(html).toContain("data-code=");
  });
});
