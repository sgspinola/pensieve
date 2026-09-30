import type { PluggableList } from "unified";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypePrismCommon from "rehype-prism-plus/common";

/**
 * `rehype-sanitize`'s default (GitHub-style) schema, extended only to keep
 * `@uiw/react-markdown-preview`'s own decorative output intact:
 *
 * - The heading anchor-link (`rehype-autolink-headings`, rewritten by the
 *   library's own internal `rehype-rewrite` pass) and the code-block copy
 *   button (same pass) both inject raw `<svg>`/`<path>` icons, plus a
 *   couple of classes/attributes, that the default schema doesn't know —
 *   since that markup comes from the library itself, not from anything a
 *   markdown author writes, it's safe to allow explicitly rather than have
 *   sanitize silently strip it. Both the anchor-link `<a>` and the copy
 *   button's `<div>` set raw `class`/`data-code` properties directly (not
 *   hast's usual camelCase `className`/`dataCode` — an inconsistency in the
 *   vendored library, not something we control), and the copy button's
 *   click handler (`useCopied`) walks up the DOM looking for exactly
 *   `classList.contains('copied')` + `dataset.code`, so dropping either
 *   silently breaks the copy-to-clipboard feature rather than just its
 *   look. Re-check this block if `@uiw/react-markdown-preview` changes its
 *   internal markup.
 * - `clobberPrefix` (the default schema's anti-DOM-clobbering measure,
 *   which prefixes `id`/`name` with `user-content-`) is left at its
 *   default rather than disabled. This pipeline's plugins run in
 *   library-fixed order — `rehype-slug` sets each heading's `id` and
 *   `rehype-autolink-headings` points an `href="#that-id"` at it *before*
 *   our plugins ever run — so sanitize would prefix the `id` alone,
 *   desyncing it from the `href` that targets it and breaking every
 *   heading anchor link. `prefixHeadingAnchorHrefs` below fixes that
 *   narrowly (rewriting just those `href`s to carry the same prefix,
 *   before sanitize applies it to the `id`), rather than clearing
 *   `clobberPrefix` schema-wide and losing clobber protection for every
 *   other id/name on the page.
 *
 * `className` on code elements (for `rehype-prism-plus/common`'s
 * `language-*` classes) is already permitted by the default schema, so no
 * extension is needed for syntax highlighting itself.
 */
const schema = structuredClone(defaultSchema);
schema.tagNames = [...(schema.tagNames ?? []), "svg", "path"];
schema.attributes = {
  ...schema.attributes,
  a: [...(schema.attributes?.a ?? []), ["class", "anchor"], "ariaHidden"],
  div: [...(schema.attributes?.div ?? []), ["class", "copied"], "data-code"],
  svg: [["className", /^octicon/], "viewBox", "version", "width", "height", "fill", "ariaHidden"],
  path: ["fillRule", "d"],
};

/** Minimal shape we need from a hast node — avoids pulling in `@types/hast`
 * (not otherwise a project dependency) just for this one small tree walk. */
type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/**
 * Rewrites each heading anchor-link's `href="#slug"` (set by
 * `rehype-autolink-headings`, before our plugins run) to
 * `href="#${clobberPrefix}slug"`, matching the `id` that `rehype-sanitize`
 * is about to produce from the same slug. See the schema comment above for
 * why this exists instead of clearing `clobberPrefix`.
 */
function prefixHeadingAnchorHrefs() {
  return (tree: HastNode) => {
    walk(tree);
  };

  function walk(node: HastNode) {
    if (node.type === "element" && node.tagName && /^h[1-6]$/.test(node.tagName)) {
      const anchor = node.children?.find(
        (child) => child.type === "element" && child.tagName === "a",
      );
      const href = anchor?.properties?.href;
      if (anchor && typeof href === "string" && href.startsWith("#")) {
        anchor.properties = {
          ...anchor.properties,
          href: `#${defaultSchema.clobberPrefix ?? ""}${href.slice(1)}`,
        };
      }
    }
    for (const child of node.children ?? []) {
      if (child.type === "element") walk(child);
    }
  }
}

/**
 * Shared rehype pipeline for every markdown render surface: MarkdownEditor's
 * Preview tab and ItemRow's read-only view. Both use `@uiw/react-markdown-
 * preview`'s `/nohighlight` entry point, which omits `rehype-raw` — literal
 * HTML in the source is never parsed into live DOM. Before `rehype-sanitize`
 * was added, react-markdown's default handling showed it instead as escaped
 * text (e.g. a literal `<script>` tag was visible on the page as the text
 * `<script>...`); `rehype-sanitize` now drops those raw-HTML fragments from
 * the tree outright (their inner text, if any, still renders as plain
 * text), closing the gap explicitly instead of relying on `rehype-raw`
 * simply never being enabled. GFM (tables, task lists, strikethrough) is
 * already included by the library's own default `remarkPlugins` regardless
 * of entry point.
 *
 * `rehype-sanitize` runs before `rehype-prism-plus/common` here — but note
 * this whole array is appended *after* the library's own internal rehype
 * plugins (slug/autolink-headings/rewrite/attr; see `@uiw/react-markdown-
 * preview`'s `nohighlight` entry point), so sanitize actually runs on a
 * tree that already has those plugins' markup in it, which is exactly what
 * `prefixHeadingAnchorHrefs` and the schema extension above account for.
 * Ordering sanitize before `rehype-prism-plus/common` still matters: prism
 * injects its `language-*`-classed markup *after* sanitization runs,
 * straight into the already-sanitized tree, so its output is never itself
 * sanitized (and doesn't need to be — it's derived from code the sanitizer
 * already saw as plain text, not from raw HTML).
 */
export const MARKDOWN_REHYPE_PLUGINS: PluggableList = [
  prefixHeadingAnchorHrefs,
  [rehypeSanitize, schema],
  [rehypePrismCommon, { ignoreMissing: true }],
];
