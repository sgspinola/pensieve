# 61: Investigation-grade app logging

**What to build:** After an incident, the maintainer can tie app activity to a source and reconstruct every attempt to get in. Every `/api/*` request log line also carries the client IP, user agent and Cloudflare ray ID. Every authentication-relevant action logs an explicit event on both success and failure. Page loads still aren't logged: they're read-only, and the API line plus the auth events cover everything that changes state or grants access. Logs keep spec 11's 30-day retention, which also limits how long IP addresses (personal data) are kept. There's no spec: the decisions come from the security-logging analysis.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The per-request API log line adds `clientIp` from `CF-Connecting-IP`, `userAgent` and `cfRay`. The header is only trusted because the tunnel is the only way in, and that's stated where it's read. Absent headers, as in local dev, are omitted rather than faked
- [ ] Explicit auth events, success and failure, with user ID where known and never secrets, challenges or recovery codes: passkey login, recovery-code use, invite redemption, passkey added or removed, session created, logout, and a session rejected by the proxy
- [ ] Vitest covers the new fields and each auth event's success and failure line
- [ ] Matching `docs/flows/` pages updated
