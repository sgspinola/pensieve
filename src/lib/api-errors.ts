import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getLogger, withContext } from "@/lib/logging";
import { REQUEST_ID_HEADER } from "@/lib/request-id";
import { AppError, NotFoundError, UnauthorizedError, ValidationError } from "@/services/errors";

/**
 * Maps a service-layer error thrown inside a route handler to its HTTP
 * response; anything else is rethrown so it surfaces as a 500 rather than
 * being silently swallowed.
 *
 * @deprecated Superseded by `withErrorHandling`, which wraps the whole route
 * handler (consistent `{ error: { code, message, requestId } }` envelope,
 * baseline request logging, and a safe fallback for non-AppError throws)
 * rather than just the one `catch` line this requires per route. Kept for
 * the routes tickets 05–07 haven't migrated yet.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof ValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  throw err;
}

type RouteHandler<Args extends unknown[]> = (
  request: Request,
  ...rest: Args
) => Promise<NextResponse> | NextResponse;

/**
 * Wraps a Next.js route handler so every request gets:
 *
 * - One baseline log line (route, method, response status, duration in ms,
 *   authenticated user ID, request ID) regardless of outcome.
 * - A consistent `{ error: { code, message, requestId } }` envelope for any
 *   thrown `AppError` subclass, built from the error's own `code`/`status`/
 *   `message` — logged at `warning`.
 * - A generic, safe 500 for anything else thrown (no stack trace or
 *   exception message in the response body — those go in the `error` log
 *   line at `error` level instead, since logs aren't user-facing).
 *
 * The success-path response is returned unchanged; only thrown errors are
 * intercepted.
 *
 * The handler itself runs inside `withContext({ requestId }, ...)`, so any
 * logger call it makes anywhere in its call graph (e.g. a service's
 * mutation log) automatically carries `requestId` too — Proxy's own
 * `withContext` binding (`src/proxy.ts`) doesn't reach across the Proxy →
 * Route Handler boundary, so this is the binding that actually covers a
 * route handler's execution.
 */
export function withErrorHandling<Args extends unknown[]>(
  handler: RouteHandler<Args>,
): (request: Request, ...rest: Args) => Promise<NextResponse> {
  return async (request: Request, ...rest: Args) => {
    const start = Date.now();
    const method = request.method;
    const route = new URL(request.url).pathname;
    const requestId = request.headers.get(REQUEST_ID_HEADER) ?? undefined;
    const logger = getLogger(["pensieve", "api"]);

    const userId = await currentUserId();
    const baseFields = () => ({
      route,
      method,
      durationMs: Date.now() - start,
      userId,
      requestId,
    });

    try {
      const response = await withContext({ requestId, userId }, () => handler(request, ...rest));
      logger.info("Request handled", { ...baseFields(), status: response.status });
      return response;
    } catch (err) {
      if (err instanceof AppError) {
        logger.warn("Request failed with a known error", {
          ...baseFields(),
          status: err.status,
          code: err.code,
        });
        // ValidationError's field-level `issues` (ticket 13's parseOrThrow
        // bridge) only ever reaches the client through this envelope, so a
        // non-empty list is included; anything else (or an empty list) omits
        // the key entirely rather than sending `issues: []`.
        const issues =
          err instanceof ValidationError && err.issues.length > 0 ? err.issues : undefined;
        return NextResponse.json(
          { error: { code: err.code, message: err.message, requestId, ...(issues ? { issues } : {}) } },
          { status: err.status },
        );
      }

      // The real error is only ever logged, never returned to the client —
      // the response body must never leak internals (stack traces, DB
      // connection strings, etc.) that a thrown non-AppError might carry.
      logger.error("Request failed unexpectedly", { ...baseFields(), status: 500, error: err });
      return NextResponse.json(
        { error: { code: "INTERNAL", message: "Something went wrong. Please try again.", requestId } },
        { status: 500 },
      );
    }
  };
}

// Best-effort: most routes withErrorHandling wraps are authenticated, but
// some (login/recovery) intentionally aren't, and getCurrentUser() throws
// UnauthorizedError when there's no session yet. Either way the baseline log
// line should still be written, just without a userId.
async function currentUserId(): Promise<string | undefined> {
  try {
    const user = await getCurrentUser();
    return user.id;
  } catch {
    return undefined;
  }
}
