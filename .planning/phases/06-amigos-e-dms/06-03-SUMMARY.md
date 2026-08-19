---
phase: 06-amigos-e-dms
plan: 03
subsystem: api
tags: [convex, friends, presence, indexes]

# Dependency graph
requires:
  - phase: 06-02
    provides: sendFriendRequest, acceptFriendRequest, rejectFriendRequest, getCallerUser, canonicalPair
  - phase: 02 (presence)
    provides: presence.by_user index, ONLINE_THRESHOLD_MS/isOnline derivation pattern (convex/members.ts)
provides:
  - "listFriends query: friends list with derived online/offline status"
  - "listIncomingFriendRequests query: pending requests received (never sent)"
  - "removeFriendship mutation: bidirectional, authorized removal, DM history preserved"
affects: [06-06 (UI amigos), 06-05 (DM listing, sibling plan)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reused isOnline() from convex/members.ts instead of redefining ONLINE_THRESHOLD_MS locally, avoiding a second online/offline definition drifting from the members list"
    - "Union of two indexed queries (by_pair prefix + by_userB) for 'all friendships of X' — no .filter() table scan"

key-files:
  created: []
  modified:
    - convex/friends.ts
    - convex/friends.test.ts

key-decisions:
  - "Deviated from the plan's inline code snippet: instead of defining a local `ONLINE_THRESHOLD_MS = 90_000` in friends.ts (as literally written in the plan body), imported `isOnline` from convex/members.ts. This follows the plan's own hard_constraint ('Do not redefine online... reuse it rather than duplicating the number') which supersedes the plan's illustrative code block."
  - "removeFriendship authorization is implicit via canonicalPair: a third party's friendUserId never forms the same canonical pair as the real friendship, so the by_pair lookup returns null and the mutation throws before any write — no separate membership check needed."
  - "listFriends returns '???' placeholder fields for a friend whose users doc is missing (defensive, matches existing rejectFriendRequest-adjacent style), but this path is unreachable in current schema (no user deletion mutation exists yet)."

patterns-established:
  - "Presence derivation for any new list must import isOnline from convex/members.ts, never redefine the threshold."

# Metrics
duration: ~20min
completed: 2026-08-18
---

# Phase 06 Plan 03: Lista e Remoção de Amigos Summary

**`convex/friends.ts` gains `listFriends` (with presence reused from `convex/members.ts`), `listIncomingFriendRequests`, and `removeFriendship` — completing all 6 friend-related backend functions for Phase 6, all covered by 24 vitest cases.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2/2 completed
- **Files modified:** 2 (`convex/friends.ts`, `convex/friends.test.ts`)

## Accomplishments
- `listFriends` query: unions `by_pair` (prefix on `userA`) and `by_userB` for "all friendships of X", joins `users` + `presence`, derives online/offline via `isOnline()` imported from `convex/members.ts` (no threshold duplication).
- `listIncomingFriendRequests` query: reads only `friendRequests` where the caller is `toUserId` via the `by_to` index — never leaks sent requests.
- `removeFriendship` mutation: looks up the friendship by canonical pair, throws if not found (covers both "never were friends" and "third party not part of this pair"), deletes only the `friendships` document — `dmChannels`/`dmMembers`/`dmMessages` are left untouched per 06-RESEARCH.md.
- No `workosId` is ever returned by any of the three new functions — only `userId`/`username`/`tag`/`displayName`/`avatarUrl`/`online`.

## Task Commits

Per orchestrator instruction (`NO_GIT`), no git commands were run. All changes are uncommitted in the working tree:
- `convex/friends.ts` (+107/-3 per `git diff --stat`)
- `convex/friends.test.ts` (+193 lines)

## Files Created/Modified
- `convex/friends.ts` - Added `listFriends`, `listIncomingFriendRequests`, `removeFriendship`; imported `isOnline` from `./members`; widened `getCallerUser`'s ctx type to `MutationCtx | QueryCtx` so it's reusable from both mutations and queries.
- `convex/friends.test.ts` - Added `describe` blocks for `friends.listFriends` (4 tests: auth rejection, both directions of canonical pair, online/offline via recent/old/missing presence), `friends.listIncomingFriendRequests` (2 tests: auth rejection, only-received-not-sent), `friends.removeFriendship` (4 tests: auth rejection, non-friend rejection with no write, third-party authorization, bidirectional removal from either side verified via both `friendships` table and both users' `listFriends`).

## Decisions Made
- Reused `isOnline` from `convex/members.ts` rather than the plan's literal inline snippet (which redefined `ONLINE_THRESHOLD_MS = 90_000` locally) — the plan's own hard_constraint explicitly forbids redefining "online", and this constraint takes precedence over the illustrative code block in the task body. Behavior is identical (same 90s threshold, same semantics), only the source of truth changed.
- `getCallerUser`'s type signature broadened from `MutationCtx` to `MutationCtx | QueryCtx` since it's now called from queries (`listFriends`, `listIncomingFriendRequests`) in addition to mutations — no behavior change, `ctx.auth`/`ctx.db.query` are available on both context types.

## Deviations from Plan

None requiring Rule 4 (architectural). One intentional adherence-to-constraint-over-snippet deviation documented above (reusing `isOnline` instead of duplicating the threshold), which is what the plan's hard_constraints explicitly demanded.

## Issues Encountered
None specific to this plan. `npm run typecheck` shows a pre-existing failure in `src/renderer/src/components/shell/ChannelSidebar.tsx` (missing `CreateChannelDialog`/`InviteDialog` modules) — unrelated to `convex/friends.ts`, caused by sibling agents 04-06/04-07 editing `src/renderer/` concurrently (confirmed via `git status --short`, those files show as modified by another in-progress agent). Not fixed, per instruction to flag rather than fix issues clearly belonging to siblings. Similarly, `npx vitest run convex` shows one failure in `convex/dms.test.ts` ("Target cannot be null or undefined" in the pagination test) — that file is being concurrently edited by sibling plan 06-05 (`convex/dms.ts`/`convex/dms.test.ts` both show as modified in `git status`), not touched by this plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
`convex/friends.ts` is now complete: all 6 Phase 6 friend-related functions exist
(`sendFriendRequest`, `acceptFriendRequest`, `rejectFriendRequest` from 06-02;
`listFriends`, `listIncomingFriendRequests`, `removeFriendship` from this plan).
Plan 06-06 (Friends UI) can now build against this module. No blockers.

Verification run at completion time:
- `npx tsc --noEmit -p convex/tsconfig.json` — clean, no output.
- `npx vitest run convex/friends.test.ts` — 24/24 tests passed.
- `npx vitest run convex` (full suite) — 100/101 passed; the 1 failure is in
  `convex/dms.test.ts`, owned by concurrently-running sibling plan 06-05.
- `npm run typecheck` — fails only on `src/renderer/.../ChannelSidebar.tsx`
  (sibling plans 04-06/04-07 mid-edit in `src/renderer/`), unrelated to this plan's files.

---
*Phase: 06-amigos-e-dms*
*Completed: 2026-08-18*
