/**
 * True for a Postgres unique-violation (23505). Drizzle wraps the driver's
 * `postgres.PostgresError` in its own `DrizzleQueryError`, attached as
 * `.cause`, so both layers need checking. Shared by any service that turns
 * a would-be duplicate-key insert/update into its own domain error rather
 * than letting the raw driver error surface.
 *
 * Checks the error's `code` field by duck-typing rather than importing the
 * `postgres` package for an `instanceof postgres.PostgresError` check: this
 * module was once reachable from client-bundled code (flashcards.ts, then
 * imported by the "use client" FlashcardRow.tsx for canDeleteFlashcard, now
 * in the pure permissions.ts), and `postgres` itself needs Node's
 * `tls`/`net` — importing it here broke the client webpack build entirely
 * ("Module not found: Can't resolve 'tls'"). Keeping it import-free stays
 * the cheaper default.
 *
 * Also checks the constructor name is "PostgresError" (not just the `code`
 * value) so an unrelated error that happens to carry a `.code === "23505"`
 * field for its own reasons isn't misread as a real duplicate-key
 * violation — still without importing the class itself.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23505" &&
    err.constructor?.name === "PostgresError"
  ) {
    return true;
  }
  if (err instanceof Error && err.cause) {
    return isUniqueViolation(err.cause);
  }
  return false;
}
