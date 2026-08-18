---
phase: 04-servidores-e-canais
plan: 03
subsystem: database
tags: [convex, channels, authorization, indexes, testing, tdd]

# Dependency graph
requires:
  - phase: 04-servidores-e-canais
    provides: "04-01: channels table (by_server index), requireMembership from convex/lib/membership.ts"
provides:
  - "convex/channels.ts: createChannel, listChannels, getChannel — all requiring requireMembership"
affects: [04-06-canais-reais-e-convite, 07-voz (voiceStates attaches to channels of type 'voice')]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "position computed as current channel count at creation time (existing.length) — new channel always appended to the end, no reorder logic in this phase"
    - "getChannel returns null for a missing/stale channelId (does not throw) but still requires membership before returning any field of a channel that does exist — a non-member cannot distinguish 'wrong id' from 'real channel I can't see' by response shape alone, since both authorized-null and unauthorized-throw are non-2xx-with-data outcomes for a caller with no membership row"

key-files:
  created:
    - convex/channels.ts
    - convex/channels.test.ts
  modified: []

key-decisions:
  - "listChannels sorts in memory after .collect() (by position ascending) rather than adding a position index — per-server channel counts are small (PITFALLS.md §6/§Pagination note in 04-RESEARCH.md), and 'position' isn't a field Convex index range-queries would help with here since every channel of the server is fetched anyway"
  - "createChannel/listChannels/getChannel use requireMembership only, never requireOwnership — SRV-05 says 'a member creates a channel,' not 'the owner creates a channel'; no invented dono-only restriction"

patterns-established:
  - "Every list query in this file goes through withIndex('by_server', ...) — no .filter() over the channels table"

# Metrics
duration: ~15min
completed: 2026-08-18
---

# Phase 04 Plan 03: Canais de servidor Summary

**Added `convex/channels.ts` (createChannel/listChannels/getChannel), all three gated by `requireMembership`, with the direct SRV-06 negative tests (non-member cannot read or write any channel) covered by 3 of the 10 passing convex-test cases.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-08-18T21:xx (see file mtime)
- **Tasks:** 1/1 (single TDD feature, RED → GREEN, no REFACTOR needed)
- **Files modified:** 2 (both created)

## Accomplishments

- `convex/channels.ts` created with `createChannel` (mutation), `listChannels` (query), `getChannel` (query) — every one calls `requireMembership(ctx, serverId)` from `convex/lib/membership.ts` before touching `channels`, matching the plan's `key_links` requirement exactly.
- `createChannel` validates `name.trim()` is 1-50 chars, accepts `type: 'text' | 'voice'`, and computes `position` as the current count of the server's channels at creation time — verified with a test that creates a text then a voice channel and checks `position` 0 and 1 respectively.
- `listChannels` uses `withIndex('by_server', q => q.eq('serverId', serverId))` (never `.filter()`), collects, then sorts by `position` ascending in memory — verified with a 3-channel ordering test and a cross-server isolation test (channels of server B never appear in server A's list).
- `getChannel` returns `null` for a non-existent `channelId` without throwing (verified by deleting a real channel and re-querying its stale id), but requires membership **before** returning any field for a channel that does exist.
- SRV-06 covered directly and specifically for channels, as instructed: non-member `createChannel` → rejects, channel count stays 0 (`convex/channels.test.ts:100-116`); non-member `listChannels` → rejects, no data returned (`convex/channels.test.ts:184-199`); non-member `getChannel` on a real channel id → rejects (not `null`, not the data) (`convex/channels.test.ts:255-271`). Each of these three tests would fail if the corresponding `requireMembership` call were removed — confirmed by construction (the call is the only thing standing between the identity check and the data access in each handler).

## Task Commits

Per plan-executor instructions for this run (`<NO_GIT>`), **no git commands were executed**. All files below are present in the working tree, uncommitted — the orchestrator commits in series.

1. **Task: Canais de texto e voz — createChannel/listChannels/getChannel (TDD)** — uncommitted (files: `convex/channels.test.ts` written RED first and confirmed failing against a non-existent module, then `convex/channels.ts` written GREEN, confirmed 10/10 passing; no REFACTOR pass needed — no real duplication between the three handlers beyond the one-line `requireMembership` call, which is intentionally repeated per plan's `key_links` rather than abstracted further)

## Files Created/Modified

- `convex/channels.ts` (created) — `createChannel` mutation, `listChannels` and `getChannel` queries. Exports match the plan's `artifacts.exports` exactly: `createChannel`, `listChannels`, `getChannel`.
- `convex/channels.test.ts` (created) — 10 tests following the exact `convexTest`/`anyApi`/`import.meta.glob`/`t.withIdentity` pattern from `convex/servers.test.ts` and `convex/presence.test.ts`.

**Module to register in `convex/_generated/api.ts`:** `channels` (i.e. `import type * as channels from "../channels.js"`, added to the `fullApi` module map as `channels: typeof channels`). Per file-ownership instructions I did not touch `_generated/api.ts` myself — three sibling agents are also adding modules there and the orchestrator updates it once at the end.

## Decisions Made

- No `requireOwnership` used anywhere in this file — SRV-05 explicitly says a member (not specifically the owner) creates channels, and the plan explicitly calls out not inventing an owner-only restriction the requirement doesn't ask for. Kept as written.
- `position` reordering (drag-to-reorder, moving channels) is out of scope per the plan — `position` is write-once-on-create (`existing.length`), no update mutation for it exists in this file. This matches "não é preciso lógica de reordenação nesta fase" in the plan body.
- REFACTOR step of the TDD cycle: skipped deliberately. The plan says to extract shared validation logic "só se o REFACTOR revelar duplicação real, não antecipar" — the only repeated line across the three handlers is the one-line `requireMembership` call itself, which is the intended pattern (every domain function calls it directly), not duplication to eliminate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test-file type inference required explicit `Id<'channels'>`/`Doc<'channels'>[]` annotations**

- **Found during:** running `npm run typecheck:convex` after GREEN (tests passed at runtime, but `tsc` failed)
- **Issue:** Same class of issue documented in 04-01's SUMMARY for `servers.test.ts`. `anyApi.channels.createChannel`/`listChannels` are typed as `FunctionReference<any, any>` since tests use `anyApi` (not the generated, still-unregistered `api`). Passing an untyped `any` id straight into `ctx.db.get(...)` made TypeScript infer the return as the union of every table's document type (missing `type`/`position` fields), and an untyped `list` array made `.map((c) => ...)` an implicit-`any` error under `strict`.
- **Fix:** Added `import type { Doc, Id } from './_generated/dataModel'`; annotated `textChannelId`/`voiceChannelId` as `Id<'channels'>` and the `listChannels` result as `Doc<'channels'>[]` at their call sites — test-only typing fix, no behavior or production-code change.
- **Files modified:** `convex/channels.test.ts`
- **Verification:** `npx tsc --noEmit -p convex/tsconfig.json` and `npm run typecheck:convex` both clean after the fix; `npx vitest run convex/channels.test.ts` still 10/10 passing (typing fix didn't touch behavior).
- **Committed in:** n/a (no git commands run this session, per `<NO_GIT>`)

---

**Total deviations:** 1 auto-fixed (1 blocking, test-only typing — same recurring `convex-test` + `anyApi` generic-inference gap already documented in 04-01's summary; not a defect in `convex/lib/membership.ts` or `convex/channels.ts`)
**Impact on plan:** No scope creep, no production code affected.

## Issues Encountered

While running `npm run typecheck:convex` mid-session (before my own fix above), I also observed transient type errors in `convex/members.test.ts` (a sibling agent's file, 04-04, actively being edited concurrently). Per the `<file_ownership>` instructions I did not touch that file. By the time of the final verification pass (below), those errors were gone — the sibling agent had resolved them independently in the interim. Confirmed not caused by, or fixed by, anything in this plan.

## Next Phase Readiness

- 04-06 (canais reais e convite, UI wiring) can call `channels.createChannel`/`listChannels`/`getChannel` directly once `_generated/api.ts` is regenerated/updated with the `channels` module.
- Phase 7 (voz) can attach `voiceStates` keyed by a `channels` document with `type: 'voice'` — the type discriminator (`v.union(v.literal('text'), v.literal('voice'))`) is exactly what a later `voiceStates` table would filter/join against; nothing in this plan referenced or created `voiceStates`, staying in scope.
- No blockers for downstream plans. The one thing the orchestrator needs to do (per file-ownership instructions) is add `channels` to `convex/_generated/api.ts`'s module map alongside whatever `invites`, `members`, and `friends`/DM modules the sibling agents also report.

## Verification Output

```
$ npx tsc --noEmit -p convex/tsconfig.json
(no output — clean)

$ npm run typecheck
> janja@1.0.0 typecheck
> npm run typecheck:node && npm run typecheck:web && npm run typecheck:convex
(all three clean, no output)

$ npx vitest run convex/channels.test.ts
 RUN  v1.6.1 /home/leo/workspace/janja
 ✓ convex/channels.test.ts  (10 tests) 52ms
 Test Files  1 passed (1)
      Tests  10 passed (10)

$ npx vitest run
 RUN  v1.6.1 /home/leo/workspace/janja
 ✓ convex/users.test.ts  (4 tests) 30ms
 ✓ convex/servers.test.ts  (9 tests) 61ms
 ✓ convex/members.test.ts  (9 tests) 56ms
 ✓ convex/invites.test.ts  (13 tests) 108ms
 ✓ convex/channels.test.ts  (10 tests) 114ms
 ✓ convex/lib/tag.test.ts  (5 tests) 11ms
 ✓ convex/lib/inviteCode.test.ts  (6 tests) 16ms
 ✓ convex/presence.test.ts  (3 tests) 23ms
 Test Files  8 passed (8)
      Tests  59 passed (59)
```

(Full-suite numbers above include the three sibling plans' files — 04-02 `invites.ts`/`inviteCode.ts`, 04-04 `members.ts` — running concurrently in the same working tree; only `convex/channels.ts` and `convex/channels.test.ts` are this plan's output.)

---

*Phase: 04-servidores-e-canais*
*Completed: 2026-08-18*
