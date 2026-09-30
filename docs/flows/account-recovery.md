# Account Recovery

Covers how a user regains access after losing their passkey device, using
one of the one-time recovery codes issued at registration. Routes:
`src/app/api/auth/recover/options/route.ts`,
`src/app/api/auth/recover/verify/route.ts`, backed by
`src/services/auth/recovery-codes.ts` and `completeAccountRecovery` in
`src/services/auth/webauthn.ts`.

## Where recovery codes come from

Ten recovery codes are generated once — and only once — per account:
`generateRecoveryCodes` (`src/services/auth/recovery-codes.ts:17-34`) is
called at the moment an account is created, both for the bootstrap admin
(`registerPasskey`, `webauthn.ts:181-184`) and for an invited member
(`redeemInvite`, `webauthn.ts:250-253`) — see
[Register with invite](/flows/register-with-invite). Each code is shown to
the caller exactly once, in the registration response; only its SHA-256
hash (`recoveryCodes.codeHash`) is ever persisted, so a stolen DB dump
can't be replayed as a usable code — the same pattern session tokens and
invite tokens use (see [Database schema](/architecture/database-schema)).

**There is no code that calls `generateRecoveryCodes` anywhere else in the
codebase** — recovery itself does not reissue a fresh batch. A user's ten
codes are a fixed, non-renewing pool for the lifetime of the account; each
one is single-use (`redeemRecoveryCode`'s `usedAt IS NULL` guard,
`recovery-codes.ts:66-81`), and there's no admin or self-service action
that tops the pool back up. Worth surfacing this to users explicitly if
Pensieve is ever deployed for real: running out of unused codes with no
working passkey is a genuine account-lockout risk this design accepts.

## Recovery ceremony

Recovering swaps in a *replacement* passkey — it isn't just "log back in,"
it's "prove you hold a valid recovery code, then register a brand-new
credential that becomes the account's only one."

```mermaid
sequenceDiagram
    actor Browser
    participant OptRoute as POST /api/auth/recover/options
    participant VerRoute as POST /api/auth/recover/verify
    participant RecoverySvc as services/auth/recovery-codes.ts
    participant Webauthn as services/auth/webauthn.ts
    participant Session as services/auth/session.ts
    participant Cookies as lib/auth-cookies.ts
    participant DB as Postgres (via Drizzle)

    Browser->>OptRoute: POST { code }
    alt code missing/blank/wrong-type (options/route.ts:16, via schema.ts + parseOrThrow in lib/validation.ts — ticket 16)
        OptRoute-->>Browser: 400 { error: { code: "VALIDATION", message, requestId } }
    else code present
        OptRoute->>RecoverySvc: findRecoveryCodeUser(db, code)
        Note right of RecoverySvc: non-mutating lookup — only identifies<br/>whose ceremony this is, doesn't consume<br/>the code (recovery-codes.ts:36-42)
        RecoverySvc->>DB: select user_id from recovery_codes where<br/>code_hash = sha256(code) and used_at is null
        alt no matching unused code (recovery-codes.ts:52-54)
            DB-->>RecoverySvc: none
            RecoverySvc-->>OptRoute: throw UnauthorizedError("Invalid or already-used recovery code")
            OptRoute-->>Browser: 401 { error: { code: "UNAUTHORIZED",<br/>message: "Invalid or already-used recovery code", requestId } }
        else found
            DB-->>RecoverySvc: { userId }
            RecoverySvc-->>OptRoute: { userId }
            OptRoute->>Webauthn: generatePasskeyRegistrationOptionsForUser(db, userId)
            Webauthn->>DB: select * from users where id = :userId
            alt user row missing (webauthn.ts:273-275)
                Note right of Webauthn: defensive — shouldn't happen given<br/>the FK the code row came from
                Webauthn-->>OptRoute: throw UnauthorizedError("Unknown user")
                OptRoute-->>Browser: 401 { error: { code: "UNAUTHORIZED",<br/>message: "Unknown user", requestId } }
            else user found
                Webauthn->>Webauthn: buildRegistrationOptions(user.displayName)
                Webauthn-->>OptRoute: options (incl. challenge)
                OptRoute->>Cookies: setChallengeCookie(challenge)<br/>setRecoveryCodeCookie(code)
                OptRoute-->>Browser: 200 options JSON
            end
        end
    end

    Note over Browser: navigator.credentials.create(options) —<br/>on-device authenticator ceremony for the<br/>NEW (replacement) passkey

    Browser->>VerRoute: POST /api/auth/recover/verify { response }

    alt body.response fails registrationResponseSchema (verify/route.ts:18, ticket 14)
        VerRoute-->>Browser: 400 { error: { code: "VALIDATION", message, issues } }
        Note right of VerRoute: shape-only check via<br/>parseOrThrow(registrationResponseSchema, ...)<br/>(services/auth/webauthn-schema.ts) — rejected<br/>before ever reaching @simplewebauthn/server
    end

    VerRoute->>VerRoute: read webauthn_challenge and<br/>recovery_code cookies
    alt challenge or code cookie missing (verify/route.ts:24)
        VerRoute-->>Browser: 400 { error: "Missing or expired recovery ceremony" }
    else all present
        VerRoute->>Cookies: clearChallengeCookie()<br/>clearRecoveryCodeCookie()
        Note right of VerRoute: single-use to this attempt regardless of<br/>outcome — same pattern as invite/verify
        VerRoute->>Webauthn: completeAccountRecovery(db, { code, response, expectedChallenge })

        Webauthn->>Webauthn: verifyRegistration(response, expectedChallenge)
        alt verification fails (webauthn.ts:92-98)
            Webauthn-->>VerRoute: throw UnauthorizedError("Passkey registration could not be verified")
            VerRoute-->>Browser: 401 { error: { code: "UNAUTHORIZED",<br/>message: "Passkey registration could not be verified", requestId } }
        else verified
            Note right of Webauthn: verify BEFORE redeeming the code — a<br/>cancelled/failed ceremony (dismissed<br/>prompt, timeout) must not cost the user<br/>one of their limited recovery attempts<br/>(webauthn.ts:285-288)
            Webauthn->>RecoverySvc: redeemRecoveryCode(db, code)
            RecoverySvc->>DB: update recovery_codes set used_at = now()<br/>where code_hash = :hash and used_at is null<br/>returning user_id
            Note right of DB: atomic, race-safe — same WHERE-clause-as-guard<br/>idiom as claimInvite (recovery-codes.ts:59-65)
            alt code already used since /options (recovery-codes.ts:76-78)
                DB-->>RecoverySvc: none
                RecoverySvc-->>Webauthn: throw UnauthorizedError("Invalid or already-used recovery code")
                Webauthn-->>VerRoute: rethrow
                VerRoute-->>Browser: 401 { error: { code: "UNAUTHORIZED",<br/>message: "Invalid or already-used recovery code", requestId } }
            else redeemed
                DB-->>RecoverySvc: { userId }
                RecoverySvc-->>Webauthn: { userId }
                Webauthn->>DB: db.transaction:<br/>delete from webauthn_credentials where user_id = :userId<br/>insert into webauthn_credentials (new credential)<br/>delete from sessions where user_id = :userId<br/>select * from users where id = :userId
                Note right of DB: old credential AND every existing session<br/>revoked in the same transaction as attaching<br/>the new passkey — the device holding the old<br/>passkey is gone, so leaving it (or sessions<br/>opened from it) valid would defeat recovery<br/>(webauthn.ts:289-292)
                alt new credential UNIQUE violation (webauthn.ts:316-318)
                    DB-->>Webauthn: unique constraint error
                    Webauthn-->>VerRoute: throw UnauthorizedError("This passkey is already registered")
                    VerRoute-->>Browser: 401 { error: { code: "UNAUTHORIZED",<br/>message: "This passkey is already registered", requestId } }
                else transaction commits
                    DB-->>Webauthn: user row
                    Webauthn->>Session: createSession(db, user.id)
                    Session-->>Webauthn: { token, expiresAt }
                    Webauthn-->>VerRoute: { user, session }
                    VerRoute->>Cookies: setSessionCookie(session)
                    VerRoute-->>Browser: 200 { user }
                end
            end
        end
    end

    opt any other (non-AppError) thrown error (api-errors.ts:74-95, withErrorHandling catch_clause)
        VerRoute-->>Browser: 500 { error: { code: "INTERNAL",<br/>message: "Something went wrong. Please try again.", requestId } }
        Note right of VerRoute: withErrorHandling wraps the whole handler for<br/>both /options and /verify — every AppError throw<br/>above and this fallback come from its one catch<br/>block. The real error is only ever logged, never<br/>returned to the client.
    end
```

## Notable details

- **This is a one-passkey-at-a-time model.** Recovery deletes *every*
  existing `webauthn_credentials` row for the user before inserting the
  replacement (`webauthn.ts:308-309`) — there's no concept of multiple
  registered devices to choose among; recovering with one code replaces
  whatever passkey(s) existed with exactly one new one.
- **Recovery force-logs-out every session**, not just the one making the
  recovery request (`delete from sessions where user_id = :userId`,
  `webauthn.ts:310`) — if the account was logged in on another device or
  browser, that session is invalidated too. This is treated as correct
  behavior, not a side effect to work around: the doc comment frames it as
  the whole point (the old device is presumed compromised or gone).
- **The response never includes new recovery codes.** `POST
  /api/auth/recover/verify` returns only `{ user }`
  (`recover/verify/route.ts:43`), unlike registration's `{ user,
  recoveryCodes }`. Combined with the "no regeneration" fact above, a user
  who recovers their account is left with one fewer usable code than before
  (the one they just spent), permanently.
- **`findRecoveryCodeUser`'s non-mutating lookup exists for exactly one
  reason**: `/options` needs to know *whose* replacement-passkey ceremony
  to build (`generatePasskeyRegistrationOptionsForUser` needs a `userId`)
  before that ceremony has succeeded — so the code can't be marked used
  yet. Actual redemption is deferred to `/verify`, mirroring
  [Register with invite](/flows/register-with-invite)'s
  check-then-claim split for the same reason.
