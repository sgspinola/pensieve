import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import {
  CHALLENGE_COOKIE_NAME,
  clearChallengeCookie,
  setSessionCookie,
} from "@/lib/auth-cookies";
import { withErrorHandling } from "@/lib/api-errors";
import { parseOrThrow } from "@/lib/validation";
import { registerPasskey } from "@/services/auth/webauthn";
import { registrationResponseSchema } from "@/services/auth/webauthn-schema";

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const response = parseOrThrow(registrationResponseSchema, body?.response);
  const displayName =
    typeof body?.displayName === "string" ? body.displayName.trim() : "";

  const cookieStore = await cookies();
  const expectedChallenge = cookieStore.get(CHALLENGE_COOKIE_NAME)?.value;

  if (!displayName || !expectedChallenge) {
    return NextResponse.json(
      { error: "Missing registration response" },
      { status: 400 },
    );
  }

  const { user, session, recoveryCodes } = await registerPasskey(getDb(), {
    response,
    expectedChallenge,
    displayName,
  });

  clearChallengeCookie(cookieStore);
  setSessionCookie(cookieStore, session);

  return NextResponse.json({ user, recoveryCodes });
});
