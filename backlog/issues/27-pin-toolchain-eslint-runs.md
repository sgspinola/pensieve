# 27: Pin the toolchain so ESLint runs

**What to build:** ESLint crashes on startup because `typescript-eslint` supports `typescript >=4.8.4 <6.1.0` and the repo is on TypeScript 7.0.2. Pin TypeScript to 6.0.3 (the last JS-based release), tell Dependabot to ignore TypeScript ≥ 7 until typescript-eslint supports it, and pin/declare Node and npm so CI and local installs resolve identically and honour the `allowScripts` allowlist. The end state is a lint run that actually executes and comes back clean, so the CI lint gate can start green. Spec: `backlog/specs/10-ci-pipeline.md` (user stories 8–10).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] TypeScript pinned to exactly 6.0.3; lockfile updated
- [ ] Dependabot npm config ignores `typescript` versions ≥ 7
- [ ] `.nvmrc` pins Node 24; `package.json` declares an `engines` field for Node 24 and npm 11.16.0
- [ ] `npm run lint` runs to completion without crashing
- [ ] Any pre-existing lint errors are fixed (or explicitly disabled with a justification comment) so `npm run lint` exits 0
- [ ] `tsc --noEmit` exits 0 under TypeScript 6.0.3
- [ ] `npm test` still passes
