# 08: Client-side error boundaries

**What to build:** Next.js error boundaries — a per-segment `error.tsx` plus one root `global-error.tsx` under `src/app` — so a render crash on any page degrades to a scoped, generic fallback ("something went wrong, try again") instead of blanking the whole app. UI fallback only; no client-to-server crash reporting.

**Blocked by:** None (can start immediately)

**Status:** done

**Completed:** on `feat/08-client-error-boundaries`
**Pull Request:** https://github.com/sgspinola/pensieve-archive/pull/5

- [x] `error.tsx` added at the appropriate route segments under `src/app`, catching render crashes at the most local boundary possible
- [x] One root `global-error.tsx` added as the top-level fallback
- [x] Each fallback shows a generic message with no internal details (stack traces, raw exception text) leaked
- [x] Playwright smoke spec: a route forced to crash actually renders its `error.tsx` fallback after real render/hydration — not an HTTP-level check, since that can't catch a component that crashes on actual render
