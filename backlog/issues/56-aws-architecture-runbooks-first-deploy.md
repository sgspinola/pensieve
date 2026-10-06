# 56: Docs: AWS architecture, bootstrap and deploy runbooks, first real deploy

**What to build:** The environment can be rebuilt and released from written procedures that have actually been followed once. An AWS architecture page shows the request path Cloudflare → Tunnel → `cloudflared` sidecar → app → RDS over IAM auth, plus the network layout, the app and DB images, the roles and the cost structure, with Mermaid diagrams. A bootstrap runbook goes from an empty account to a running app: prerequisites, bootstrap config, prod apply, first release, `db-bootstrap`, first `deploy-db`, first `deploy-app`, then the maintainer-only GitHub/Semgrep/CodeQL steps. A deploy runbook covers which workflow to dispatch for each kind of change, expected downtime, marking a migration breaking, failure handling and rollback. Both are proven by a real first deploy and one deliberate breaking-migration window. Spec: `backlog/specs/12-release-and-operations.md` (user stories 19, 21–23, 27, 29, 30; "Deploy order", "Documentation"); `backlog/specs/13-database-lifecycle.md` (Testing Decisions: real runs).

**Blocked by:** 52 (`deploy-app`), 54 (`deploy-db`), 58–61 (security logging, so the first real deploy runs with it on)

**Status:** ready-for-agent

- [ ] AWS architecture page under `docs/architecture/` with request-path and network Mermaid diagrams, both images, roles and cost structure
- [ ] Bootstrap runbook lists every manual prerequisite (Identity Center, Cloudflare tokens, `plan`/`prod-app`/`prod-db` Environments and secrets, Semgrep token, CodeQL, rulesets) and the first-deploy order
- [ ] Deploy runbook covers app-only, DB-only additive, additive + app, and breaking-window deploys; the breaking marker rule of thumb; failure handling; and rollback (breaking: restore snapshot, then `deploy-app` with the previous SHA)
- [ ] Real run following the runbooks: bootstrap, first `deploy-db`, first `deploy-app`; `https://pensieve.fyi` serves the app and a passkey can be registered
- [ ] One deliberate breaking-migration window: first dispatched without `app_sha` (refused, app recovers), then with it (succeeds)
- [ ] Architecture page shows the security-logging layout (trail, log bucket prefixes and retention, Flow/Resolver logs, RDS and app log groups); the bootstrap runbook covers the trail and log bucket
- [ ] Runbook "Investigating an incident" section: where each question is answered (Athena for CloudTrail, Flow and Resolver logs; Logs Insights for RDS and app logs; Event History; Cloudflare's audit log) with starting queries, each tried against real data from the first deploy
- [ ] Any discrepancy found during the runs is fixed in the runbooks; `docs/METHODOLOGY.md` entries added; `docs-build` passes
