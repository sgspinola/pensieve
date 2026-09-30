import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import {
  CHALLENGE_COOKIE_NAME,
  RECOVERY_CODE_COOKIE_NAME,
  clearChallengeCookie,
  clearRecoveryCodeCookie,
  setSessionCookie,
} from "@/lib/auth-cookies";
import { withErrorHandling } from "@/lib/api-errors";
import { parseOrThrow } from "@/lib/validation";
import { completeAccountRecovery } from "@/services/auth/webauthn";
import { registrationResponseSchema } from "@/services/auth/webauthn-schema";

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const response = parseOrThrow(registrationResponseSchema, body?.response);

  const cookieStore = await cookies();
  const expectedChallenge = cookieStore.get(CHALLENGE_COOKIE_NAME)?.value;
  const code = cookieStore.get(RECOVERY_CODE_COOKIE_NAME)?.value;

  if (!expectedChallenge || !code) {
    return NextResponse.json(
      { error: "Missing or expired recovery ceremony" },
      { status: 400 },
    );
  }

  // Both cookies are single-use to this one ceremony attempt regardless of
  // outcome: a failed attempt must not leave them live for a retry by
  // whoever else has access to this browser within the cookie's lifetime.
  clearChallengeCookie(cookieStore);
  clearRecoveryCodeCookie(cookieStore);

  const { user, session } = await completeAccountRecovery(getDb(), {
    code,
    response,
    expectedChallenge,
  });

  setSessionCookie(cookieStore, session);

  return NextResponse.json({ user });
});
