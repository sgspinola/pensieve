import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { clearSessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth-cookies";
import { withErrorHandling } from "@/lib/api-errors";
import { deleteSession } from "@/services/auth/session";

export const POST = withErrorHandling(async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await deleteSession(getDb(), token);
    clearSessionCookie(cookieStore);
  }

  return NextResponse.json({ ok: true });
});
