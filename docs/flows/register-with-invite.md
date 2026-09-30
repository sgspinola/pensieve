# Register with Invite

Covers how a second (and every subsequent) user joins the workspace: opening
an `/invite/<token>` link and completing passkey registration. Routes:
`src/app/invite/[token]/page.tsx`, `src/app/api/auth/invite/options/route.ts`,
`src/app/api/auth/invite/verify/route.ts`, backed by
`src/services/auth/invites.ts` and `src/services/auth/webauthn.ts`.

## Registration has exactly two paths, and this is only one of them

It's worth being explicit up front, because the routes' names are easy to
conflate: `src/app/api/auth/register/*` (`options`/`verify`) is a
**separate, bootstrap-only** path — it creates the sole `admin` account
the very first time the app is used, and is permanently closed off once any
user exists (`assertBootstrapEligible`, `src/services/auth/webauthn.ts:44-50`,
called from both `generatePasskeyRegistrationOptions` and `registerPasskey`).
`src/services/auth/webauthn.ts:135-139`'s own doc comment says it plainly:
"Bootstraps the sole admin account when `users` is empty; otherwise no open
registration path exists — member registration is driven only by an invite
token." This page covers that second, ongoing path: `/api/auth/invite/*`,
which creates a `member` account and is the only way a workspace grows past
its first user.

## Opening the link

`/invite/[token]` (`src/app/invite/[token]/page.tsx`) is a Server Component
that calls `isInviteRedeemable(db, token)`
(`src/services/auth/invites.ts:76-83`) before rendering anything — a
non-throwing wrapper around `assertInviteRedeemable`
(`invites.ts:61-70`), which checks the invite row exists, is unused
(`usedAt IS NULL`), and hasn't expired (`expiresAt > now()`), matched by the
**hash** of the token (`unredeemedInviteFilter`, `invites.ts:14-20`) —
the raw token is never stored. A dead link (already used, expired, or
simply invalid) renders a plain error message instead of the registration
form; nothing about that check is DB-mutating, so refreshing the page or
opening the same link in two tabs is safe.

## Registration ceremony

```mermaid
sequenceDiagram
    actor Browser
    participant Page as /invite/[token] (Server Component)
    participant OptRoute as POST /api/auth/invite/options
    participant VerRoute as POST /api/auth/invite/verify
    participant InvitesSvc as services/auth/invites.ts
    participant Webauthn as services/auth/webauthn.ts
    participant Session as services/auth/session.ts
    participant Recovery as services/auth/recovery-codes.ts
    participant Cookies as lib/auth-cookies.ts
    participant DB as Postgres (via Drizzle)

    Browser->>Page: GET /invite/:token
    Page->>InvitesSvc: isInviteRedeemable(db, token)
    InvitesSvc->>DB: select id from invites where<br/>token_hash = sha256(token) and used_at is null<br/>and expires_at > now()
    alt no matching row (invites.ts:67-69)
        DB-->>InvitesSvc: none
        InvitesSvc-->>Page: false
        Page-->>Browser: renders "invalid, already used, or expired"
    else redeemable
        DB-->>InvitesSvc: row
        InvitesSvc-->>Page: true
        Page-->>Browser: renders InviteForm (displayName input)
    end

    Note over Browser: User enters a display name, submits

    Browser->>OptRoute: POST { token, displayName }
    alt token or displayName missing/blank/wrong-type (options/route.ts:16, via schema.ts + parseOrThrow in lib/validation.ts — ticket 16)
        OptRoute-->>Browser: 400 { error }
    else both present
        OptRoute->>Webauthn: generatePasskeyRegistrationOptionsForInvite(db, { token, displayName })
        Webauthn->>InvitesSvc: assertInviteRedeemable(db, token)
        alt not redeemable (invites.ts:67-69)
            InvitesSvc-->>Webauthn: throw UnauthorizedError("Invite link is invalid, already used, or expired")
            Webauthn-->>OptRoute: rethrow
            OptRoute-->>Browser: 401 { error: { code: "UNAUTHORIZED",<br/>message: "Invite link is invalid, already used, or expired", requestId } }
        else redeemable — re-checked here, not just at page load
            Webauthn->>Webauthn: buildRegistrationOptions(displayName)<br/>-> @simplewebauthn/server generateRegistrationOptions()
            Webauthn-->>OptRoute: options (incl. challenge)
            OptRoute->>Cookies: setChallengeCookie(challenge)<br/>setInviteTokenCookie(token)
            Note right of Cookies: both single-use to this one attempt —<br/>cleared unconditionally at /verify below,<br/>success or failure
            OptRoute-->>Browser: 200 options JSON
        end
    end

    Note over Browser: navigator.credentials.create(options) —<br/>on-device authenticator ceremony

    Browser->>VerRoute: POST /api/auth/invite/verify { response, displayName }

    alt body.response fails registrationResponseSchema (verify/route.ts:18, ticket 14)
        VerRoute-->>Browser: 400 { error: { code: "VALIDATION", message, issues } }
        Note right of VerRoute: shape-only check via<br/>parseOrThrow(registrationResponseSchema, ...)<br/>(services/auth/webauthn-schema.ts) — rejected<br/>before ever reaching @simplewebauthn/server
    end

    VerRoute->>VerRoute: read webauthn_challenge and<br/>invite_token cookies
    alt displayName, challenge, or token cookie missing (verify/route.ts:26)
        VerRoute-->>Browser: 400 { error: "Missing or expired invite ceremony" }
    else all present
        VerRoute->>Cookies: clearChallengeCookie()<br/>clearInviteTokenCookie()
        Note right of VerRoute: cleared before the outcome is even known —<br/>this ceremony attempt is single-use either way
        VerRoute->>Webauthn: redeemInvite(db, { token, response, expectedChallenge, displayName })

        Webauthn->>Webauthn: verifyRegistration(response, expectedChallenge)
        Note right of Webauthn: @simplewebauthn/server checks signature +<br/>origin + RP ID + challenge match in one call —<br/>any failure (including a thrown error, e.g.<br/>origin mismatch) maps to one UnauthorizedError
        alt verification fails (webauthn.ts:92-98)
            Webauthn-->>VerRoute: throw UnauthorizedError("Passkey registration could not be verified")
            VerRoute-->>Browser: 401 { error: { code: "UNAUTHORIZED",<br/>message: "Passkey registration could not be verified", requestId } }
        else verified
            Note right of Webauthn: Verification happens BEFORE claiming the<br/>invite — a cancelled/failed ceremony must<br/>never burn the one-time link (webauthn.ts:214-216)
            Webauthn->>InvitesSvc: claimInvite(db, token)
            InvitesSvc->>DB: update invites set used_at = now()<br/>where token_hash = :hash and used_at is null<br/>and expires_at > now() returning id
            Note right of DB: atomic, race-safe: the WHERE clause re-checks<br/>unused+unexpired at UPDATE time, so two<br/>concurrent redemptions of the same link can<br/>each only "win" the row once (invites.ts:86-91)
            alt no row updated — already claimed/expired since the options call (invites.ts:100-102)
                DB-->>InvitesSvc: none
                InvitesSvc-->>Webauthn: throw UnauthorizedError("Invite link is invalid, already used, or expired")
                Webauthn-->>VerRoute: rethrow
                VerRoute-->>Browser: 401 { error: { code: "UNAUTHORIZED",<br/>message: "Invite link is invalid, already used, or expired", requestId } }
            else claimed successfully
                DB-->>InvitesSvc: { id }
                InvitesSvc-->>Webauthn: invite
                Webauthn->>DB: db.transaction: insert into users<br/>(display_name, role='member') returning *<br/>insert into webauthn_credentials (...)<br/>update invites set used_by = user.id where id = invite.id
                alt credential UNIQUE violation — this passkey already registered (webauthn.ts:243-245)
                    DB-->>Webauthn: unique constraint error
                    Webauthn-->>VerRoute: throw UnauthorizedError("This passkey is already registered")
                    VerRoute-->>Browser: 401 { error: { code: "UNAUTHORIZED",<br/>message: "This passkey is already registered", requestId } }
                else transaction commits
                    DB-->>Webauthn: new user row
                    par
                        Webauthn->>Session: createSession(db, user.id)
                    and
                        Webauthn->>Recovery: generateRecoveryCodes(db, user.id)
                    end
                    Session-->>Webauthn: { token, expiresAt }
                    Recovery-->>Webauthn: recoveryCodes[] (shown once)
                    Webauthn-->>VerRoute: { user, session, recoveryCodes }
                    VerRoute->>Cookies: setSessionCookie(session)
                    VerRoute-->>Browser: 200 { user, recoveryCodes }
                    Note over Browser: recovery codes must be shown/saved now —<br/>only their hashes are ever persisted<br/>(see Account recovery)
                end
            end
        end
    end
```

## Notable details

- **The invite is re-checked twice, independently, and claimed exactly
  once.** The page-load check (`isInviteRedeemable`) and the `/options`
  check (`assertInviteRedeemable`, called fresh inside
  `generatePasskeyRegistrationOptionsForInvite`) are both read-only and
  don't reserve anything — a link could still be redeemed by someone else
  between either of those checks and the final claim. `claimInvite`'s
  atomic `UPDATE ... WHERE used_at IS NULL AND expires_at > now() ...
  RETURNING id` (`invites.ts:93-105`) is the only step that actually
  consumes the token, and it's race-safe by construction: the same WHERE
  clause is re-evaluated at UPDATE time, so a second concurrent attempt
  simply updates zero rows rather than double-claiming.
- **Verify-then-claim ordering is deliberate**, not incidental:
  `redeemInvite` runs `verifyRegistration` before `claimInvite`
  (`webauthn.ts:227-228`) specifically so a browser-dismissed or timed-out
  WebAuthn prompt never burns the one-time link — the same ordering
  principle used in [Account recovery](/flows/account-recovery).
- **Both the challenge and invite-token cookies are cleared unconditionally**
  at the top of the `/verify` handler (`verify/route.ts:33-34`), before the
  ceremony's outcome is known — a failed attempt can't be retried with the
  same challenge/token pair, forcing a fresh `/options` call (and a fresh
  redeemability check) for another try.
- **A brand-new invited member gets recovery codes at registration time**,
  exactly like the bootstrap admin — `generateRecoveryCodes` runs in
  parallel with `createSession` (`webauthn.ts:250-253`). See
  [Account recovery](/flows/account-recovery) for how those get used later.
