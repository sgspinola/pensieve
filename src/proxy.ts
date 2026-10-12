import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { SESSION_COOKIE_NAME, USER_HEADER_NAME, encodeUserHeader } from "@/lib/auth-cookies";
import { ensureLoggingConfigured, withContext } from "@/lib/logging";
import { REQUEST_ID_HEADER } from "@/lib/request-id";
import { getSessionUser } from "@/services/auth/session";

ensureLoggingConfigured();

export const config = {
  // `icon` is the Next.js-generated route serving app/icon.svg (see
  // node_modules/next/dist/docs/.../app-icons.md) — it needs the same
  // unauthenticated access as favicon.ico so the tab icon renders on the
  // login/invite screens too.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon).*)"],
};

// Re-exported so existing importers (e.g. proxy.test.ts) keep working — see
// src/lib/request-id.ts, the shared source of truth for the header name.
export { REQUEST_ID_HEADER };

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/register/options",
  "/api/auth/register/verify",
  "/api/auth/login/options",
  "/api/auth/login/verify",
  "/api/auth/recover/options",
  "/api/auth/recover/verify",
  "/api/auth/invite/options",
  "/api/auth/invite/verify",
  // Ticket 28: the readiness probe (container HEALTHCHECK, CI e2e) has no
  // session to present. Exact-match only, and the route returns nothing
  // beyond up/down — see src/app/api/health/route.ts.
  "/api/health",
]);

// `/invite/<token>` is the one page an unauthenticated visitor can land on
// besides /login — it's how an invitee registers their own passkey. It's
// still gated by the token's own validity (see redeemInvite), not open
// self-registration: this only widens *which unauthenticated page* is
// reachable, not who can create an account.
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/invite/");
}

/**
 * The global auth gate: every page and API route requires a valid session
 * except the small set of endpoints needed to establish one. There is no
 * unauthenticated page anywhere, including the landing page.
 *
 * This does a real DB lookup per request rather than the "optimistic,
 * cookie-only" check Next's own docs recommend for Proxy (Proxy also runs on
 * prefetches, so a DB-backed check adds load there too). That tradeoff is
 * deliberate for this app: it's a handful of trusted users on a sub-€10/month
 * budget, and a DB-backed session is what makes immediate server-side
 * revocation possible (recovery-code redemption, admin action) without also
 * maintaining a stateless-JWT + revocation-list pair. Revisit if this app
 * ever needs to scale traffic well past its current single-digit-user shape.
 */
export async function proxy(request: NextRequest) {
  // Guarantee LogTape's contextLocalStorage is actually wired up before
  // withContext() below relies on it — ensureLoggingConfigured() kicks off
  // configuration once per process (see module-level call above) but
  // configure() is async, so an unawaited race would make withContext()
  // silently no-op on cold start. Once configured, this resolves immediately.
  await ensureLoggingConfigured();

  // Preserve a correlation ID an upstream caller (load balancer, another
  // service) already stamped on the request; otherwise mint a fresh one. A
  // present-but-empty header is treated the same as absent, so a
  // misbehaving upstream can't blank out correlation for its requests.
  const incomingRequestId = request.headers.get(REQUEST_ID_HEADER);
  const requestId = incomingRequestId || crypto.randomUUID();

  // Binding it via withContext (backed by the AsyncLocalStorage wired into
  // LogTape in src/lib/logging.ts) means every getLogger(...) call anywhere
  // in this request's call graph — including inside getSessionUser — picks
  // it up automatically, with no manual threading.
  return withContext({ requestId }, async () => {
    const response = await handleRequest(request, requestId);
    // Surfaced back to the caller so it can correlate its own logs/traces
    // with ours, whether the ID was generated here or just echoed back.
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  });
}

async function handleRequest(request: NextRequest, requestId: string): Promise<NextResponse> {
  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next({ request: { headers: withRequestId(request.headers, requestId) } });
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  try {
    const user = await getSessionUser(getDb(), token);

    // Forward the already-validated user (and the request ID — see
    // withRequestId) to the app via request headers, so pages don't repeat
    // this DB lookup and route handlers (src/lib/api-errors.ts's
    // withErrorHandling) can read the request ID without relying on
    // LogTape's context propagating across the Proxy/route-handler boundary,
    // which Next's own docs warn isn't guaranteed. `NextResponse.next({
    // request: { headers } })` only affects what the server receives — it
    // never reaches the client — and any client-supplied value for
    // USER_HEADER_NAME is deleted first so it can't be spoofed.
    const requestHeaders = withRequestId(request.headers, requestId);
    requestHeaders.delete(USER_HEADER_NAME);
    requestHeaders.set(USER_HEADER_NAME, encodeUserHeader(user));

    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.redirect(new URL("/login", request.url));
  }
}

function withRequestId(headers: Headers, requestId: string): Headers {
  const withId = new Headers(headers);
  withId.set(REQUEST_ID_HEADER, requestId);
  return withId;
}
