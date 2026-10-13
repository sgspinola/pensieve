import "server-only";
import { getLogger } from "@/lib/logging";

/**
 * Ticket 61: one explicit log line per authentication-relevant action, on
 * success and on failure, so every attempt to get in can be reconstructed
 * after an incident. Lines carry the event, its outcome and the user ID
 * where it's known; a failure adds the error's message as `reason`. Never
 * secrets, challenges, tokens or recovery codes: callers pass only the
 * fields below. Inside a route handler or the Proxy, the log context adds
 * the request ID and the client's IP, user agent and Cloudflare ray ID
 * (src/lib/client-fields.ts).
 */
export type AuthEvent =
  | "passkey_login"
  | "recovery_code_use"
  | "invite_redemption"
  | "admin_registration"
  | "passkey_added"
  | "passkey_removed"
  | "session_created"
  | "logout"
  | "session_rejected";

export interface AuthEventFields {
  userId?: string;
  // Which step of a multi-request flow failed, e.g. the options request
  // that checks an invite or recovery code before the passkey ceremony.
  stage?: string;
  // The Proxy's rejections only: the path that was refused.
  path?: string;
}

const logger = getLogger(["pensieve", "auth"]);

export function logAuthSuccess(event: AuthEvent, fields: AuthEventFields = {}): void {
  logger.info("Auth event succeeded", { event, outcome: "success", ...fields });
}

export function logAuthFailure(event: AuthEvent, error: unknown, fields: AuthEventFields = {}): void {
  logger.warn("Auth event failed", {
    event,
    outcome: "failure",
    ...fields,
    reason: error instanceof Error ? error.message : String(error),
  });
}
