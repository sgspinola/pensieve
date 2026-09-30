import { z } from "zod";

/**
 * Zod schema for `POST /api/items/metadata`'s body (ticket 17) — used with
 * `parseOrThrow` (ticket 13) in place of the former hand-rolled
 * `typeof body?.url !== "string" || !body.url.trim()` check. That check
 * treated a missing, wrong-type, and blank `url` identically (one
 * "url is required" message); the constructor-level `{ message }` override
 * below is what reproduces that exact three-way equivalence — omitting it
 * (the `registerOptionsBodySchema`-style default) would give a missing or
 * wrong-type `url` Zod's generic type-mismatch message instead, which is a
 * real behavior change the ticket doesn't ask for. Unlike before, a
 * present-but-malformed URL (e.g. "not-a-url") is now also rejected, with
 * its own "url must be a valid URL" message, instead of silently reaching
 * `fetchUrlMetadata`.
 */
export const metadataBodySchema = z.object({
  url: z
    .string({ message: "url is required" })
    .trim()
    .min(1, "url is required")
    .pipe(z.url("url must be a valid URL")),
});

export type MetadataBody = z.infer<typeof metadataBodySchema>;
