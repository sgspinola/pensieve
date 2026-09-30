/**
 * Extracts the error message an API route's error response carries, falling
 * back to a generic message for a response that isn't JSON-shaped that way
 * (e.g. a raw 500). Shared by every client-side form that calls this app's
 * own API routes.
 *
 * Two body shapes exist side by side right now: the legacy flat
 * `{ error: "..." }` toErrorResponse() has always produced, and the newer
 * `{ error: { code, message, requestId } }` envelope withErrorHandling()
 * (ticket 04) produces for its pilot routes. Both are handled here until
 * tickets 05–07 finish migrating every route onto withErrorHandling.
 */
export async function readErrorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  const error = body?.error;

  if (typeof error === "string") return error;
  if (typeof error?.message === "string") return error.message;
  return "Something went wrong";
}
