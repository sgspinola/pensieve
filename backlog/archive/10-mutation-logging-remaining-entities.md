# 10: Mutation logging — kind/id for remaining entities

**What to build:** Apply the same kind/id mutation-logging pattern established in ticket 09 to the remaining entity families, all of which are create-or-delete only (no update/diff step needed): tags, invites, sessions, recovery codes, and WebAuthn credentials/users.

**Blocked by:** 09 (Mutation logging: field-diff for item/flashcard updates)

**Status:** done

**Completed:** on `feat/10-mutation-logging-remaining-entities`
**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/16

- [x] Tag create/delete log `entityKind: "tags"` and `entityId`, success or failure
- [x] Invite create/delete log `entityKind: "invites"` and `entityId`, success or failure
- [x] Session create/delete log `entityKind: "sessions"` and `entityId`, success or failure
- [x] Recovery code create/delete log `entityKind: "recoveryCodes"` and `entityId`, success or failure
- [x] WebAuthn credential/user create/delete log `entityKind: "webauthnCredentials"` (or `"webauthnUsers"` as applicable) and `entityId`, success or failure
- [x] Vitest: log-content assertions for at least one representative create and one representative delete per entity family
