# 16: Auth options endpoints — request-body validation

**What to build:** Zod schemas replacing the current hand-rolled `typeof`/`trim` checks on the three auth "options" endpoints that take a body: `register/options` (`displayName`), `invite/options` (`token`, `displayName`), and `recover/options` (`code`). `login/options` and `admin/invites` take no body and are unaffected.

**Blocked by:** 13 (Zod-to-ValidationError bridge)

**Status:** done

**Completed:** on `feat/16-auth-options-body-validation`

**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/12

- [x] Zod schema for `POST /api/auth/register/options` body (`displayName: string`, non-empty after trim)
- [x] Zod schema for `POST /api/auth/invite/options` body (`token: string`, `displayName: string`, both non-empty after trim)
- [x] Zod schema for `POST /api/auth/recover/options` body (`code: string`, non-empty after trim)
- [x] Existing hand-rolled checks in these three routes removed in favor of the schemas
- [x] TypeScript types for each parsed body inferred via `z.infer`
- [x] Vitest: valid body passes through for each of the three schemas; missing/empty/wrong-type field produces the expected `issues` for each
