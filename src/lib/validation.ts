import type { ZodType, z } from "zod";
import { ValidationError } from "@/services/errors";

/**
 * Runs a Zod schema against `data` and returns the parsed, typed value.
 *
 * Uses `schema.safeParse`, so this is strict, fail-closed parsing: no
 * coercion beyond what the schema itself declares (e.g. `z.coerce.number()`
 * or a `.default(...)`) is applied. On failure, throws a single
 * `ValidationError` whose `issues` array has exactly one `{ field, message }`
 * entry per violation Zod reports — never one thrown error per violation.
 *
 * Field-path format (every ticket that builds a schema on top of this
 * helper relies on this exact shape, so treat it as a contract):
 *   - Object keys are dot-joined: `address.city`
 *   - Array indices use bracket notation: `tags[1]`
 *   - Nested combinations compose left-to-right: `items[0].name`
 *   - A root-level issue (e.g. from a top-level `.refine()`) has no path
 *     segments, so `field` is the empty string `""`.
 */
export function parseOrThrow<Schema extends ZodType>(
  schema: Schema,
  data: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(data);

  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue) => ({
    field: formatPath(issue.path),
    message: issue.message,
  }));

  throw new ValidationError("Validation failed", issues);
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((field, segment) => {
    if (typeof segment === "number") {
      return `${field}[${segment}]`;
    }
    return field ? `${field}.${String(segment)}` : String(segment);
  }, "");
}
