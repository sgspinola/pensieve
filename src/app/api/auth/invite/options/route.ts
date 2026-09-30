import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { setChallengeCookie, setInviteTokenCookie } from "@/lib/auth-cookies";
import { withErrorHandling } from "@/lib/api-errors";
import { parseOrThrow } from "@/lib/validation";
import { generatePasskeyRegistrationOptionsForInvite } from "@/services/auth/webauthn";
import { inviteOptionsBodySchema } from "./schema";

// This validates the invite token (unused, unexpired) up front, before the
// invitee is prompted for a passkey — the token itself isn't claimed until
// /verify succeeds (see redeemInvite), so a cancelled/failed ceremony never
// burns the one-time link.
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const { token, displayName } = parseOrThrow(inviteOptionsBodySchema, body);

  const options = await generatePasskeyRegistrationOptionsForInvite(getDb(), {
    token,
    displayName,
  });

  const cookieStore = await cookies();
  setChallengeCookie(cookieStore, options.challenge);
  setInviteTokenCookie(cookieStore, token);

  return NextResponse.json(options);
});
