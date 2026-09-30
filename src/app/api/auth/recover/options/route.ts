import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { setChallengeCookie, setRecoveryCodeCookie } from "@/lib/auth-cookies";
import { withErrorHandling } from "@/lib/api-errors";
import { parseOrThrow } from "@/lib/validation";
import { findRecoveryCodeUser } from "@/services/auth/recovery-codes";
import { generatePasskeyRegistrationOptionsForUser } from "@/services/auth/webauthn";
import { recoverOptionsBodySchema } from "./schema";

// This only *identifies* the code's user (a non-mutating lookup) — the code
// itself isn't redeemed until /verify succeeds, so a cancelled or failed
// passkey ceremony doesn't cost the user one of their recovery attempts.
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const { code } = parseOrThrow(recoverOptionsBodySchema, body);

  const { userId } = await findRecoveryCodeUser(getDb(), code);
  const options = await generatePasskeyRegistrationOptionsForUser(getDb(), userId);

  const cookieStore = await cookies();
  setChallengeCookie(cookieStore, options.challenge);
  setRecoveryCodeCookie(cookieStore, code);

  return NextResponse.json(options);
});
