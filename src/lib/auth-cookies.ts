import type { cookies } from "next/headers";
import type { Session, SessionUser } from "@/services/auth/session";

export const SESSION_COOKIE_NAME = "session";
export const CHALLENGE_COOKIE_NAME = "webauthn_challenge";
// Carries the submitted recovery code from the recover/options step to the
// recover/verify step, where it's actually redeemed. The code isn't redeemed
// at /options — only once the replacement-passkey ceremony it sets up is
// verified — so a cancelled/failed ceremony never burns it (see
// completeAccountRecovery).
export const RECOVERY_CODE_COOKIE_NAME = "webauthn_recovery_code";
// Carries the invite token from the invite/options step to the
// invite/verify step, where it's actually redeemed — same rationale as
// RECOVERY_CODE_COOKIE_NAME: the token isn't claimed at /options, only once
// the invitee's passkey ceremony it sets up is verified (see redeemInvite),
// so a cancelled/failed ceremony never burns the one-time link.
export const INVITE_TOKEN_COOKIE_NAME = "webauthn_invite_token";

// Set by src/proxy.ts once it has validated the session, so pages can read
// the already-authenticated user without a second DB round trip. Any
// client-supplied value for this header is stripped before proxy sets it, so
// it's safe for downstream code to trust blindly.
export const USER_HEADER_NAME = "x-pensieve-user";

// HTTP header values must be ByteString (Latin-1); Headers.set() throws for
// anything outside that range. displayName is free-text (any script, emoji),
// so the JSON is base64-encoded first — base64's output alphabet is always
// ASCII regardless of the input, so this can never hit that limit.
export function encodeUserHeader(user: SessionUser): string {
  return Buffer.from(JSON.stringify(user), "utf8").toString("base64");
}

export function decodeUserHeader(raw: string): SessionUser {
  return JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as SessionUser;
}

const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const CHALLENGE_COOKIE_MAX_AGE_SECONDS = 60 * 5; // 5 minutes

type CookieStore = Awaited<ReturnType<typeof cookies>>;

// Shared by every short-lived, httpOnly, server-set secret this module
// hands to the browser (challenge, recovery code, invite token, session
// token) — only the name and lifetime differ between them.
function setSecretCookie(
  cookieStore: CookieStore,
  name: string,
  value: string,
  maxAgeSeconds: number,
): void {
  cookieStore.set(name, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export function setChallengeCookie(cookieStore: CookieStore, challenge: string): void {
  setSecretCookie(cookieStore, CHALLENGE_COOKIE_NAME, challenge, CHALLENGE_COOKIE_MAX_AGE_SECONDS);
}

export function clearChallengeCookie(cookieStore: CookieStore): void {
  cookieStore.delete(CHALLENGE_COOKIE_NAME);
}

export function setRecoveryCodeCookie(cookieStore: CookieStore, code: string): void {
  setSecretCookie(cookieStore, RECOVERY_CODE_COOKIE_NAME, code, CHALLENGE_COOKIE_MAX_AGE_SECONDS);
}

export function clearRecoveryCodeCookie(cookieStore: CookieStore): void {
  cookieStore.delete(RECOVERY_CODE_COOKIE_NAME);
}

export function setInviteTokenCookie(cookieStore: CookieStore, token: string): void {
  setSecretCookie(cookieStore, INVITE_TOKEN_COOKIE_NAME, token, CHALLENGE_COOKIE_MAX_AGE_SECONDS);
}

export function clearInviteTokenCookie(cookieStore: CookieStore): void {
  cookieStore.delete(INVITE_TOKEN_COOKIE_NAME);
}

export function setSessionCookie(cookieStore: CookieStore, session: Session): void {
  setSecretCookie(cookieStore, SESSION_COOKIE_NAME, session.token, SESSION_COOKIE_MAX_AGE_SECONDS);
}

export function clearSessionCookie(cookieStore: CookieStore): void {
  cookieStore.delete(SESSION_COOKIE_NAME);
}
