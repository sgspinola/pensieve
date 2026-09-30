import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { USER_HEADER_NAME, decodeUserHeader } from "@/lib/auth-cookies";
import { UnauthorizedError } from "@/services/errors";
import type { SessionUser } from "@/services/auth/session";

/**
 * Reads the user src/proxy.ts already validated for this request, set via a
 * trusted request header rather than re-querying the DB per page render.
 */
export async function getCurrentUser(): Promise<SessionUser> {
  const headerStore = await headers();
  const raw = headerStore.get(USER_HEADER_NAME);

  if (!raw) {
    throw new UnauthorizedError("No authenticated user on this request");
  }

  return decodeUserHeader(raw);
}

/**
 * The auth gate every authenticated page starts with: resolves the current
 * user or redirects to `/login`, mirroring the existing pattern where `/`
 * redirects an unauthenticated visitor. Shared so this redirect behavior
 * can't drift between pages that each need their own copy.
 */
export async function requireCurrentUser(): Promise<SessionUser> {
  try {
    return await getCurrentUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login");
    }
    throw err;
  }
}
