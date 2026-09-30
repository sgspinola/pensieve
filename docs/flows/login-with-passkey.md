# Login with Passkey

WebAuthn login is a two-request ceremony: an **options** call that hands the
browser a challenge, a client-side interaction with the user's authenticator
(Face ID, a security key, a platform passkey — outside this app's source
entirely), and a **verify** call that checks the signed response and starts
a session. The two routes are `src/app/api/auth/login/options/route.ts` and
`src/app/api/auth/login/verify/route.ts`; the actual WebAuthn logic lives in
`src/services/auth/webauthn.ts`.

```mermaid
sequenceDiagram
    actor Browser
    participant OptRoute as POST /api/auth/login/options
    participant VerRoute as POST /api/auth/login/verify
    participant Webauthn as services/auth/webauthn.ts
    participant Session as services/auth/session.ts
    participant Cookies as lib/auth-cookies.ts
    participant DB as Postgres (via Drizzle)

    Browser->>OptRoute: POST /api/auth/login/options
    OptRoute->>Webauthn: generatePasskeyLoginOptions()
    Note right of Webauthn: getRelyingPartyConfig() reads<br/>WEBAUTHN_RP_ID / RP_NAME / ORIGIN,<br/>then @simplewebauthn/server<br/>generateAuthenticationOptions()
    Webauthn-->>OptRoute: options (incl. challenge)
    OptRoute->>Cookies: setChallengeCookie(cookieStore, options.challenge)
    Note right of Cookies: httpOnly cookie, 5 min maxAge<br/>(auth-cookies.ts:38, :60)
    OptRoute-->>Browser: 200 options JSON

    Note over Browser: navigator.credentials.get(options) —<br/>on-device authenticator ceremony,<br/>not server-side code

    Browser->>VerRoute: POST /api/auth/login/verify { response }

    VerRoute->>VerRoute: body = await request.json().catch(() => null)

    alt body.response fails authenticationResponseSchema (verify/route.ts:16, ticket 14)
        VerRoute-->>Browser: 400 { error: { code: "VALIDATION", message, issues } }
        Note right of VerRoute: shape-only check (base64url id/rawId, literal<br/>type: "public-key", nested response object) via<br/>parseOrThrow(authenticationResponseSchema, ...)<br/>(services/auth/webauthn-schema.ts) — rejected<br/>before ever reaching @simplewebauthn/server
    end

    VerRoute->>VerRoute: expectedChallenge = cookie(webauthn_challenge)

    alt missing/expired challenge cookie (verify/route.ts:21)
        VerRoute-->>Browser: 400 { error: "Missing login response" }
    else has expectedChallenge
        VerRoute->>Webauthn: verifyPasskeyLogin(db, { response, expectedChallenge })

        Webauthn->>DB: select * from webauthn_credentials where credential_id = response.id

        alt no matching credential (webauthn.ts:349)
            Webauthn-->>VerRoute: throw UnauthorizedError("Unknown passkey credential")
            VerRoute-->>Browser: 401 { error: { code: "UNAUTHORIZED",<br/>message: "Unknown passkey credential", requestId } }
        else credential found
            Webauthn->>Webauthn: verifyAuthenticationResponse({ response,<br/>expectedChallenge, expectedOrigin, expectedRPID,<br/>credential: storedCredential })
            Note right of Webauthn: @simplewebauthn/server checks the<br/>signature against the stored public key<br/>AND that the signed challenge matches<br/>expectedChallenge (catches a mismatched<br/>or already-expired challenge cookie too)

            alt verification.verified === false (webauthn.ts:366)
                Webauthn-->>VerRoute: throw UnauthorizedError("Passkey login could not be verified")
                VerRoute-->>Browser: 401 { error: { code: "UNAUTHORIZED",<br/>message: "Passkey login could not be verified", requestId } }
            else verified
                Webauthn->>DB: update webauthn_credentials set counter = newCounter where id = storedCredential.id
                Webauthn->>DB: select * from users where id = storedCredential.user_id

                alt credential orphaned — no such user (webauthn.ts:380)
                    Webauthn-->>VerRoute: throw UnauthorizedError("Credential is not associated with a user")
                    VerRoute-->>Browser: 401 { error: { code: "UNAUTHORIZED",<br/>message: "Credential is not associated with a user", requestId } }
                else user found
                    Webauthn->>Session: createSession(db, user.id)
                    Session->>Session: token = randomBytes(32).base64url()<br/>expiresAt = now + 30d
                    Session->>DB: insert into sessions { id: sha256(token), user_id, expires_at }
                    Session-->>Webauthn: { token, expiresAt }
                    Webauthn-->>VerRoute: { user, session }

                    VerRoute->>Cookies: clearChallengeCookie(cookieStore)
                    VerRoute->>Cookies: setSessionCookie(cookieStore, session)
                    Note right of Cookies: httpOnly cookie, 30 day maxAge<br/>(auth-cookies.ts:37, :84)
                    VerRoute-->>Browser: 200 { user }
                end
            end
        end
    end

    opt any other (non-AppError) thrown error (api-errors.ts:74-95, withErrorHandling catch_clause)
        VerRoute-->>Browser: 500 { error: { code: "INTERNAL",<br/>message: "Something went wrong. Please try again.", requestId } }
        Note right of VerRoute: withErrorHandling wraps the whole handler —<br/>every AppError throw above and this fallback<br/>both come from its one catch block, not a<br/>per-route try/catch. The real error is only<br/>ever logged (`error` level), never returned.
    end
```

## Notes on the error branches

All three `UnauthorizedError` throws inside `verifyPasskeyLogin`
(`src/services/auth/webauthn.ts:338-389`) are deliberately generic-sounding
at the HTTP boundary but distinct in the source, each guarding a different
failure mode:

1. **Unknown credential** (`webauthn.ts:349`) — the `credentialId` the
   browser presented doesn't exist in `webauthn_credentials` at all. Can't
   happen from a normal login attempt with a real registered passkey;
   indicates either a stale/deleted credential or a forged request.
2. **Verification failed** (`webauthn.ts:366`) — the credential exists, but
   `verifyAuthenticationResponse()` rejected the signed assertion. This is
   the branch that actually covers both a **cryptographic signature
   mismatch** and a **challenge mismatch**: SimpleWebAuthn's verification
   checks the returned `clientDataJSON.challenge` against
   `expectedChallenge` as part of the same call, so a replayed or
   tampered-with response fails here, not as a separate case.
3. **Orphaned credential** (`webauthn.ts:380`) — the credential's `user_id`
   no longer resolves to a `users` row. Shouldn't happen given the FK
   (`webauthn_credentials.user_id -> users.id ON DELETE CASCADE` —
   see [Database Schema](/architecture/database-schema)) guarantees the
   credential is deleted alongside its user; this branch is defensive.

A **truly expired challenge** is caught earlier and separately: the
challenge cookie itself has a 5-minute `maxAge`
(`CHALLENGE_COOKIE_MAX_AGE_SECONDS`, `src/lib/auth-cookies.ts:38`). Once it
expires, the browser simply stops sending it, so `cookieStore.get(...)`
returns `undefined` and the request never reaches `verifyPasskeyLogin` at
all — it's rejected by the `verify/route.ts:18` guard with a `400`, not a
`401` from the service layer.
