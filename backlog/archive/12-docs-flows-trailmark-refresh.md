# 12: docs/flows Trailmark refresh for error-path changes

**What to build:** Regenerate the `docs/flows/*` pages whose error-path diagrams are affected by the new envelope/status behavior, via a fresh Trailmark call-graph pass, so flow documentation doesn't silently drift from the new behavior.

**Blocked by:** 05 (items routes rollout), 06 (flashcards routes rollout), 07 (auth/admin routes rollout), 08 (client error boundaries)

**Status:** done

**Completed:** on `feat/12-docs-flows-trailmark-refresh`

**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/13

- [x] Flow diagrams whose `alt`/`opt` error-path branches changed as a result of tickets 05–08 identified and regenerated
- [x] Regeneration done via a fresh Trailmark call-graph pass (the `trailmark:trailmark` skill), not graphify, per `CLAUDE.md` — a one-off tool invocation, no second persisted graph in this repo
- [x] `docs/METHODOLOGY.md` updated noting which flow pages were refreshed and by this pass
