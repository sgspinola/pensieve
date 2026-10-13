# 57: Docs: restore runbook and a practice restore

**What to build:** Recovering the database under pressure follows a procedure that has already worked once. A restore runbook covers point-in-time recovery and restoring the pre-deploy snapshot. It explains that a restore always creates a new instance, how to point the app at it, and when to use each method. Restores run locally with the maintainer's SSO admin credentials; no GitHub role can restore. Only the newest pre-deploy snapshot exists, and older states come from point-in-time recovery. The maintainer then does one deliberate practice restore after the first real deploy. Spec: `backlog/specs/12-release-and-operations.md` (user stories 24–27; "Restore").

**Blocked by:** 56 (first real deploy)

**Status:** done

**Completed:** on `feat/57-restore-runbook-and-practice-restore`

**Pull Request:** PR_URL

- [x] Restore runbook page covering point-in-time recovery vs pre-deploy snapshot, the new-instance consequence, repointing the app (including Terraform and task-definition implications) and cleanup of the old instance
- [x] States that restores are local SSO-admin operations only, and the snapshot retention model
- [ ] One practice restore performed following the runbook, and the app verified against the restored data — **deferred by the maintainer**: closed without it on 2026-10-13. The runbook carries a "not yet rehearsed" warning until it's done
- [x] Discrepancies found become runbook fixes; `docs/METHODOLOGY.md` updated; `docs-build` passes (the ones found by read-only checks against prod; the rehearsal's are still to come)
