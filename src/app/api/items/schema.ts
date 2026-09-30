import { z } from "zod";
import { isStringArray } from "@/lib/request-fields";
import { isCreatableItemKind, type CreatableItemKind } from "@/services/items/items";
import { stringOrNull } from "./zod-helpers";

/**
 * Zod schema for `POST /api/items`'s create body (ticket 17) — used with
 * `parseOrThrow` (ticket 13) in place of this route's former hand-rolled
 * `typeof`/`isStringArray` checks. `kind` decides which of `url` vs
 * `title`+`content` is required: a link/tool/article needs a `url`; a page
 * needs an authored `title`+`content` and no `url` (see items.ts's
 * createItem docs) — enforced below via `superRefine` rather than per-field
 * schemas, so a wrong-type or missing value for a conditionally-required
 * field produces exactly one issue, same as the removed hand-rolled checks.
 * `tags`/`parentId`/`description`/`notes` are optional for every kind.
 */

export const createItemBodySchema = z
  .object({
    kind: z.custom<CreatableItemKind>(isCreatableItemKind, {
      message: 'kind must be "link", "tool", "article", or "page"',
    }),
    // Left as `unknown` and fully validated in `superRefine` below (required
    // only for non-page kinds) so a wrong-type url collapses into the same
    // single "url is required" issue a missing one gets, matching the
    // removed hand-rolled check's behavior.
    url: z.unknown().optional(),
    title: stringOrNull("title").optional(),
    description: stringOrNull("description").optional(),
    notes: stringOrNull("notes").optional(),
    content: stringOrNull("content").optional(),
    tags: z.custom<string[]>(isStringArray, { message: "tags must be an array of strings" }).optional(),
    parentId: stringOrNull("parentId").optional(),
  })
  .superRefine((body, ctx) => {
    if (body.kind === "page") {
      if (typeof body.title !== "string" || !body.title.trim()) {
        ctx.addIssue({ code: "custom", message: "title is required", path: ["title"] });
      }
      if (typeof body.content !== "string" || !body.content.trim()) {
        ctx.addIssue({ code: "custom", message: "content is required", path: ["content"] });
      }
    } else if (typeof body.url !== "string" || !body.url.trim()) {
      ctx.addIssue({ code: "custom", message: "url is required", path: ["url"] });
    }
  });

export type CreateItemBody = z.infer<typeof createItemBodySchema>;
