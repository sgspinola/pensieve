import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { setChallengeCookie } from "@/lib/auth-cookies";
import { withErrorHandling } from "@/lib/api-errors";
import { parseOrThrow } from "@/lib/validation";
import { generatePasskeyRegistrationOptions } from "@/services/auth/webauthn";
import { registerOptionsBodySchema } from "./schema";

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const { displayName } = parseOrThrow(registerOptionsBodySchema, body);

  const options = await generatePasskeyRegistrationOptions(getDb(), {
    displayName,
  });

  setChallengeCookie(await cookies(), options.challenge);

  return NextResponse.json(options);
});
