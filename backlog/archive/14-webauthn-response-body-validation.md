# 14: WebAuthn verification endpoints — response-body schema validation

**What to build:** A shared Zod schema for the WebAuthn response envelope (credential `id`/`rawId` as base64url strings, a literal `type` field, the nested `response` object) applied to the request body of all four verification endpoints — `/api/auth/login/verify`, `/api/auth/register/verify`, `/api/auth/invite/verify`, `/api/auth/recover/verify` — before it's handed to `@simplewebauthn/server`. This only validates shape; it does not duplicate the library's own cryptographic verification (signature, challenge, origin/RP-ID checks). A malformed body now fails through spec 08's `ValidationError`/`issues` mechanism instead of being passed straight into the library with zero app-level shape check.

**Blocked by:** 13 (Zod-to-ValidationError bridge)

**Status:** done

**Completed:** on `feat/14-webauthn-response-body-validation`

**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/17

- [x] Shared WebAuthn response-envelope Zod schema added, colocated with the auth verification code
- [x] Schema applied to all four verify routes ahead of the existing `@simplewebauthn/server` call
- [x] A malformed body (missing field, wrong type, wrong literal `type` value) returns a 400 with field-level `issues` via `withErrorHandling`, not a raw library error or 500
- [x] TypeScript type for the parsed response is inferred via `z.infer`, not hand-written
- [x] Vitest: valid envelope passes through; each distinct invalid-shape case (missing `id`, missing `rawId`, wrong `type` literal, missing nested `response`) produces the expected `issues`
- [x] Property-based/fuzz test (new dependency) generating structurally varied malformed envelopes against the schema, confirming it never throws anything other than `ValidationError` and never accepts a structurally invalid envelope
