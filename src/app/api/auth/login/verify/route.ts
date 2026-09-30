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
import { verifyPasskeyLogin } from "@/services/auth/webauthn";
import { authenticationResponseSchema } from "@/services/auth/webauthn-schema";

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const response = parseOrThrow(authenticationResponseSchema, body?.response);

  const cookieStore = await cookies();
  const expectedChallenge = cookieStore.get(CHALLENGE_COOKIE_NAME)?.value;

  if (!expectedChallenge) {
    return NextResponse.json(
      { error: "Missing login response" },
      { status: 400 },
    );
  }

  const { user, session } = await verifyPasskeyLogin(getDb(), {
    response,
    expectedChallenge,
  });

  clearChallengeCookie(cookieStore);
  setSessionCookie(cookieStore, session);

  return NextResponse.json({ user });
});
