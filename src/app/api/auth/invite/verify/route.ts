import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import {
  CHALLENGE_COOKIE_NAME,
  INVITE_TOKEN_COOKIE_NAME,
  clearChallengeCookie,
  clearInviteTokenCookie,
  setSessionCookie,
} from "@/lib/auth-cookies";
import { withErrorHandling } from "@/lib/api-errors";
import { parseOrThrow } from "@/lib/validation";
import { redeemInvite } from "@/services/auth/webauthn";
import { registrationResponseSchema } from "@/services/auth/webauthn-schema";

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const response = parseOrThrow(registrationResponseSchema, body?.response);
  const displayName =
    typeof body?.displayName === "string" ? body.displayName.trim() : "";

  const cookieStore = await cookies();
  const expectedChallenge = cookieStore.get(CHALLENGE_COOKIE_NAME)?.value;
  const token = cookieStore.get(INVITE_TOKEN_COOKIE_NAME)?.value;

  if (!displayName || !expectedChallenge || !token) {
    return NextResponse.json(
      { error: "Missing or expired invite ceremony" },
      { status: 400 },
    );
  }

  // Both cookies are single-use to this one ceremony attempt regardless of
  // outcome: a failed attempt must not leave them live for a retry by
  // whoever else has access to this browser within the cookie's lifetime.
  clearChallengeCookie(cookieStore);
  clearInviteTokenCookie(cookieStore);

  const { user, session, recoveryCodes } = await redeemInvite(getDb(), {
    token,
    response,
    expectedChallenge,
    displayName,
  });

  setSessionCookie(cookieStore, session);

  return NextResponse.json({ user, recoveryCodes });
});
