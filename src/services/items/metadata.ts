export interface ItemMetadata {
  title: string | null;
  description: string | null;
}

const TITLE_TAG_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const META_TAG_RE = /<meta\b[^>]*>/gi;
const META_KEY_RE = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i;
const META_CONTENT_RE = /\bcontent\s*=\s*["']([^"']*)["']/i;

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#\d+|[a-z]+|#39);/gi, (match, entity: string) => {
    if (entity[0] === "#" && entity !== "#39") {
      return String.fromCharCode(Number(entity.slice(1)));
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function clean(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

/**
 * Extracts every `<meta>` tag's name/property -> content mapping, tolerant of
 * either attribute order (`name` then `content`, or vice versa).
 */
function readMetaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();

  for (const match of html.matchAll(META_TAG_RE)) {
    const tag = match[0];
    const key = tag.match(META_KEY_RE)?.[1]?.toLowerCase();
    const content = tag.match(META_CONTENT_RE)?.[1];
    if (key && content !== undefined) {
      tags.set(key, content);
    }
  }

  return tags;
}

/**
 * Parses Open Graph / `<title>` / meta-description tags out of raw HTML.
 * Open Graph tags win when present since they're purpose-built for link
 * previews; the plain `<title>`/`description` tags are the fallback for
 * pages that predate or skip Open Graph. Never throws — a page with none of
 * these tags simply yields nulls, which is a normal, expected result rather
 * than a failure.
 */
export function parseHtmlMetadata(html: string): ItemMetadata {
  const metaTags = readMetaTags(html);
  const titleTagMatch = html.match(TITLE_TAG_RE)?.[1];

  const ogTitle = metaTags.get("og:title");
  const ogDescription = metaTags.get("og:description");
  const metaDescription = metaTags.get("description");

  const title = ogTitle ?? titleTagMatch;
  const description = ogDescription ?? metaDescription;

  return {
    title: title !== undefined ? clean(title) : null,
    description: description !== undefined ? clean(description) : null,
  };
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;

/**
 * Fetches a URL server-side and parses its metadata. Failures of every kind
 * (unreachable host, non-OK response, malformed HTML) resolve to nulls
 * rather than rejecting — metadata prefill is a nice-to-have, and callers
 * (createItem) must be able to create the item regardless.
 */
export async function fetchUrlMetadata(
  url: string,
  fetchImpl: Fetcher = fetch,
): Promise<ItemMetadata> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return { title: null, description: null };
    }
    const html = await response.text();
    return parseHtmlMetadata(html);
  } catch {
    return { title: null, description: null };
  }
}
