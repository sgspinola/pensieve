import { z } from "zod";

/**
 * Shape-only Zod schema for the WebAuthn response envelope
 * (`RegistrationResponseJSON` / `AuthenticationResponseJSON` from
 * `@simplewebauthn/server`), applied to a verify route's request body
 * before it's handed to the library.
 *
 * This validates structure only — base64url-encoded strings in the right
 * places, the right literal `type`, the right nested `response` shape for
 * a registration vs. an authentication ceremony. It never duplicates the
 * library's own cryptographic verification (signature, challenge,
 * origin/RP-ID checks) — a structurally valid envelope can still fail
 * that later, and that's expected.
 */

// WebAuthn's own Base64URLString type (see @simplewebauthn/server's
// types/dom.d.ts) is just `string` — no runtime shape guarantee. The
// browser side (`isoBase64URL`) always emits unpadded base64url, so a
// non-empty base64url-alphabet string is the actual contract here.
const base64UrlString = z
  .string()
  .min(1, "must not be empty")
  .regex(/^[A-Za-z0-9_-]+$/, "must be a base64url-encoded string");

const publicKeyCredentialType = z.literal("public-key");

// AuthenticationExtensionsClientOutputs (appid/credProps/hmacCreateSecret/
// prf) is all-optional and extension-specific, but the field itself is
// required on RegistrationResponseJSON/AuthenticationResponseJSON —
// @simplewebauthn/browser always sends *some* object here (possibly `{}`),
// so this only pins down "an object", not its keys.
const clientExtensionResults = z.record(z.string(), z.unknown());

const authenticatorAttachment = z.enum(["cross-platform", "platform"]);

const attestationResponseSchema = z.object({
  clientDataJSON: base64UrlString,
  attestationObject: base64UrlString,
  authenticatorData: base64UrlString.optional(),
  transports: z.array(z.string()).optional(),
  publicKeyAlgorithm: z.number().optional(),
  publicKey: base64UrlString.optional(),
});

const assertionResponseSchema = z.object({
  clientDataJSON: base64UrlString,
  authenticatorData: base64UrlString,
  signature: base64UrlString,
  userHandle: base64UrlString.optional(),
});

/** A completed WebAuthn *registration* ceremony (register/invite/recover verify). */
export const registrationResponseSchema = z.object({
  id: base64UrlString,
  rawId: base64UrlString,
  response: attestationResponseSchema,
  authenticatorAttachment: authenticatorAttachment.optional(),
  clientExtensionResults,
  type: publicKeyCredentialType,
});

/** A completed WebAuthn *authentication* ceremony (login verify). */
export const authenticationResponseSchema = z.object({
  id: base64UrlString,
  rawId: base64UrlString,
  response: assertionResponseSchema,
  authenticatorAttachment: authenticatorAttachment.optional(),
  clientExtensionResults,
  type: publicKeyCredentialType,
});

export type RegistrationResponseInput = z.infer<typeof registrationResponseSchema>;
export type AuthenticationResponseInput = z.infer<typeof authenticationResponseSchema>;
