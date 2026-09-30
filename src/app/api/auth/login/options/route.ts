import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { setChallengeCookie } from "@/lib/auth-cookies";
import { withErrorHandling } from "@/lib/api-errors";
import { generatePasskeyLoginOptions } from "@/services/auth/webauthn";

export const POST = withErrorHandling(async () => {
  const options = await generatePasskeyLoginOptions();

  setChallengeCookie(await cookies(), options.challenge);

  return NextResponse.json(options);
});
