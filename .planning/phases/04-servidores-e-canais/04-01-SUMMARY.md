---
phase: 04-servidores-e-canais
plan: 01
subsystem: database
tags: [convex, schema, authorization, indexes, testing]

# Dependency graph
requires:
  - phase: 02-convex-auth-workos
    provides: "users table (workosId/username/tag), ensureUser + collision-retry pattern, ctx.auth.getUserIdentity() flow"
provides:
  - "schema tables: servers, serverMembers, invites, channels"
  - "convex/lib/membership.ts: requireIdentity, requireMembership, requireOwnership"
  - "convex/servers.ts: createServer, listMyServers, amIOwner"
affects: [04-02-convites, 04-03-canais, 04-04-membros, 04-05-renderer-servidores, 04-06-ui-convites, 06-01]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Centralized authorization helpers (requireIdentity/requireMembership/requireOwnership) in convex/lib/, imported (not re-exported via api) by every domain function file"
    - "Composite index (['serverId','userId']) used both for exact-match membership checks and as a queryable prefix for per-server listings, avoiding a third index"

key-files:
  created:
    - convex/lib/membership.ts
    - convex/servers.ts
    - convex/servers.test.ts
  modified:
    - convex/schema.ts
    - convex/_generated/api.ts

key-decisions:
  - "amIOwner requires membership (not just identity) before revealing the owner boolean, so a non-member learns nothing about a server it doesn't belong to (SRV-06 applied even to this UI-convenience query)"
  - "createServer/listMyServers only need requireIdentity: creating a server always makes the caller owner+member, and listMyServers is already scoped to the caller via the by_user index — there's no code path where an unauthorized server could leak"

patterns-established:
  - "Every list/lookup query in this phase must go through an index (by_server_user, by_user, by_server, by_code) — no .filter() over a full table"

# Metrics
duration: ~25min
completed: 2026-08-18
---

# Phase 04 Plan 01: Schema e fundação de servidores Summary

**Added servers/serverMembers/invites/channels tables plus a centralized membership-authorization helper (requireIdentity/requireMembership/requireOwnership) and the first working server functions (createServer, listMyServers, amIOwner), all covered by 9 passing convex-test cases.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-18T21:55Z
- **Tasks:** 2/2
- **Files modified:** 5 (2 modified, 3 created)

## Accomplishments

- Schema now has 6 tables: `users`, `presence` (Phase 2, untouched) plus `servers`, `serverMembers`, `invites`, `channels` (this plan) — `serverMembers` carries the composite `by_server_user` index plus a single-field `by_user` index, matching 04-RESEARCH.md §1/§7 exactly (no third index).
- `convex/lib/membership.ts` created as an internal (non-`api`-exported) library with `requireIdentity`, `requireMembership`, `requireOwnership` — the single place that implements SRV-06 (non-member cannot read or write server data) for the rest of the phase to import.
- `convex/servers.ts` created with `createServer` (validates name length 2-50, makes the caller both `servers.ownerId` and the sole initial `serverMembers` row), `listMyServers` (scoped strictly by the caller's own `by_user` index results), and `amIOwner` (requires membership before revealing anything, used by the invite-management UI in a later plan to decide which buttons to show — never the authorization source of truth itself).
- `convex/servers.test.ts` written following the exact `presence.test.ts` pattern (`convexTest`, `anyApi`, `import.meta.glob`, `t.withIdentity`) — 9 tests covering: unauthenticated rejection, correct owner+membership creation, name-length validation (empty/whitespace/too-long), per-user isolation of `listMyServers` between two users, and all three `amIOwner` cases (owner=true, non-owner member=false, non-member=rejects).
- `convex/_generated/api.ts` updated by hand (this machine has no Convex codegen access) to include the new `lib/membership` and `servers` modules, following the exact shape of the existing generated file — verified it typechecks under both `convex/tsconfig.json` (the runtime tsconfig `npx convex dev` uses) and the root `tsconfig.convex.json`.

## Task Commits

Per plan-executor instructions for this run, **no git commands were executed** — the orchestrator commits in series. All files below are present in the working tree, uncommitted.

1. **Task 1: Schema das 4 tabelas + helper de autorização** — uncommitted (files: `convex/schema.ts`, `convex/lib/membership.ts`)
2. **Task 2: createServer + listMyServers, testados** — uncommitted (files: `convex/servers.ts`, `convex/servers.test.ts`, `convex/_generated/api.ts`)

## Files Created/Modified

- `convex/schema.ts` (modified) — added `servers`, `serverMembers`, `invites`, `channels`; `users`/`presence` left byte-for-byte as they were before this plan.
- `convex/lib/membership.ts` (created) — `requireIdentity`, `requireMembership`, `requireOwnership`; not re-exported through `api`.
- `convex/servers.ts` (created) — `createServer` mutation, `listMyServers` and `amIOwner` queries.
- `convex/servers.test.ts` (created) — 9 tests, `convex-test` + `anyApi` pattern.
- `convex/_generated/api.ts` (modified by hand) — added `lib/membership` and `servers` to the module map so `npx tsc --noEmit -p convex/tsconfig.json` (the same check `npx convex dev` runs) and `npm run typecheck:convex` both pass; the user's `npx convex dev` will regenerate this file for real on next run, which is expected and safe.

## Decisions Made

- `amIOwner` calls `requireMembership` (not just `requireIdentity`) before returning the owner boolean — a non-member should learn nothing about a server, including whether it has an owner-only UI affordance, consistent with SRV-06 (per plan's explicit rationale, kept as written).
- `createServer`/`listMyServers` only need `requireIdentity`: there's no "create for another user" path, and `listMyServers` is already scoped by the caller's own index — no additional membership check adds safety there (also per plan, kept as written; no deviation).
- Ran `npx tsc --noEmit -p convex/tsconfig.json` in addition to the root `typecheck:convex`, since the task instructions specifically called it out as the check `npx convex dev` runs on the user's machine and a failure there would block their deploy — both pass clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test-file type inference required explicit `Id<'servers'>` annotation**

- **Found during:** Task 2 (writing `convex/servers.test.ts`)
- **Issue:** `anyApi.servers.createServer` is typed as `FunctionReference<any, any>`. When the mutation's returned `serverId` (typed `any`) was passed straight into `ctx.db.get(serverId)` inside `t.run(...)`, TypeScript's generic inference for `get<TableName extends TableNamesInDataModel<DataModel>>` fell back to its constraint (the union of *all* table names) instead of narrowing to `"servers"`, producing a union document type without an `ownerId` field and a compile error (`Property 'ownerId' does not exist on type ... presence ... | ...`).
- **Fix:** Added `import type { Id } from './_generated/dataModel'` and annotated the one variable that flows into `ctx.db.get` as `const serverId: Id<'servers'> = await asAna.mutation(...)`. This is a test-only typing fix — no behavior change, no production code touched.
- **Files modified:** `convex/servers.test.ts`
- **Verification:** `npm run typecheck:convex` and `npx tsc --noEmit -p convex/tsconfig.json` both pass clean; `npx vitest run convex/servers.test.ts` passes (9/9).
- **Committed in:** n/a (no git commands run this session, per instructions)

---

**Total deviations:** 1 auto-fixed (1 blocking, test-only typing)
**Impact on plan:** No scope creep, no production code affected — the deviation is confined to test-file generic inference and does not change any schema, helper, or function behavior described in the plan.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None — no external service configuration required. `convex/schema.ts` changes are additive only (`servers`, `serverMembers`, `invites`, `channels`); `users` and `presence` were not touched. The user's existing `npx convex dev` session on the live deployment (impressive-oyster-898) will pick up and publish these new tables/functions on its next run, and will also regenerate `convex/_generated/*` for real (this plan's hand-written `api.ts` update is a stand-in for that, shaped to match the real codegen output exactly).

## Next Phase Readiness

- Foundation is in place for 04-02 (invites), 04-03 (channels), 04-04 (members): all three can `import { requireIdentity, requireMembership, requireOwnership } from './lib/membership'` immediately, no further schema work needed for their base tables (`invites`, `channels` already exist).
- 04-05 (renderer) has `createServer`/`listMyServers` to move the UI out of the "zero servers" state.
- No blockers. One thing for the next agent touching `convex/schema.ts` (06-01, per file_ownership note) to keep in mind: this plan's 4 tables are grouped under a `// --- Fase 4: servidores e canais ---` comment at the end of the file — please keep additions similarly grouped rather than interleaving.

## Verification Output

```
$ npx tsc --noEmit -p convex/tsconfig.json
(no output — clean)

$ npm run typecheck:convex
> janja@1.0.0 typecheck:convex
> tsc --noEmit -p tsconfig.convex.json
(no output — clean)

$ npm run typecheck
> janja@1.0.0 typecheck
> npm run typecheck:node && npm run typecheck:web && npm run typecheck:convex
(all three clean, no output)

$ npx vitest run convex/servers.test.ts
 RUN  v1.6.1 /home/leo/workspace/janja
 ✓ convex/servers.test.ts  (9 tests) 40ms
 Test Files  1 passed (1)
      Tests  9 passed (9)

$ npx vitest run
 RUN  v1.6.1 /home/leo/workspace/janja
 ✓ convex/lib/tag.test.ts  (5 tests) 11ms
 ✓ convex/users.test.ts  (4 tests) 26ms
 ✓ convex/presence.test.ts  (3 tests) 34ms
 ✓ convex/servers.test.ts  (9 tests) 49ms
 Test Files  4 passed (4)
      Tests  21 passed (21)

$ npm run build
> janja@1.0.0 build
> npm run typecheck && electron-vite build
(typecheck clean)
vite v7.3.6 building ssr environment for production...
✓ 7 modules transformed. out/main/index.js  8.64 kB — built in 84ms
✓ 1 modules transformed. out/preload/index.js  1.28 kB — built in 12ms
vite v7.3.6 building client environment for production...
✓ 2014 modules transformed.
../../out/renderer/index.html                     1.48 kB
../../out/renderer/assets/index-D76KXJWW.css     38.57 kB
../../out/renderer/assets/index-CDziZekR.js   1,030.91 kB
✓ built in 1.78s
```

---

*Phase: 04-servidores-e-canais*
*Completed: 2026-08-18*
