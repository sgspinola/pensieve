import { describe, expect, it, vi } from "vitest";
import { fetchUrlMetadata, parseHtmlMetadata } from "@/services/items/metadata";

describe("parseHtmlMetadata", () => {
  it("prefers Open Graph title/description over <title>/meta description", () => {
    const html = `
      <html><head>
        <title>Fallback Title</title>
        <meta name="description" content="Fallback description." />
        <meta property="og:title" content="OG Title" />
        <meta property="og:description" content="OG description." />
      </head></html>
    `;

    expect(parseHtmlMetadata(html)).toEqual({
      title: "OG Title",
      description: "OG description.",
    });
  });

  it("falls back to <title> and meta description when no Open Graph tags exist", () => {
    const html = `
      <html><head>
        <title>Plain Title</title>
        <meta name="description" content="Plain description." />
      </head></html>
    `;

    expect(parseHtmlMetadata(html)).toEqual({
      title: "Plain Title",
      description: "Plain description.",
    });
  });

  it("returns nulls for a page with no title or metadata tags at all", () => {
    const html = "<html><head></head><body><p>Nothing here.</p></body></html>";

    expect(parseHtmlMetadata(html)).toEqual({ title: null, description: null });
  });

  it("decodes HTML entities and trims whitespace", () => {
    const html = `<title>  Tom &amp; Jerry  </title>`;

    expect(parseHtmlMetadata(html).title).toBe("Tom & Jerry");
  });

  it("handles meta attributes in either order", () => {
    const html = `<meta content="Reordered description." name="description">`;

    expect(parseHtmlMetadata(html).description).toBe("Reordered description.");
  });
});

describe("fetchUrlMetadata", () => {
  it("parses metadata from a successfully fetched page", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<title>Fetched Title</title>"),
    });

    const metadata = await fetchUrlMetadata("https://example.com", fetchImpl);

    expect(metadata).toEqual({ title: "Fetched Title", description: null });
    expect(fetchImpl).toHaveBeenCalledWith("https://example.com");
  });

  it("returns nulls instead of throwing when the page is unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(fetchUrlMetadata("https://unreachable.example", fetchImpl)).resolves.toEqual({
      title: null,
      description: null,
    });
  });

  it("returns nulls instead of throwing on a non-OK HTTP response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, text: () => Promise.resolve("") });

    await expect(fetchUrlMetadata("https://example.com/missing", fetchImpl)).resolves.toEqual({
      title: null,
      description: null,
    });
  });
});
