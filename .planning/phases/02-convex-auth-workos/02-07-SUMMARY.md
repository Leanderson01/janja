---
phase: 02-convex-auth-workos
plan: 07
subsystem: auth
tags: [react, convex, workos, ipc, contextbridge, custom-hook]

# Dependency graph
requires:
  - phase: 02-convex-auth-workos (plan 03)
    provides: window.auth typed IPC surface (signIn, signOut, getUser, getAccessToken, onAuthChange) exposed via contextBridge
  - phase: 02-convex-auth-workos (plan 04)
    provides: VITE_CONVEX_URL convention in .env.local.example, live Convex deployment
provides:
  - src/renderer/src/hooks/useAuth.ts (React hook over window.auth — user, loading, signIn, signOut)
  - src/renderer/src/hooks/useConvexAuthAdapter.ts (adapter matching ConvexProviderWithAuth's exact useAuth contract)
  - src/renderer/src/lib/convex-client.ts (singleton ConvexReactClient reading VITE_CONVEX_URL, fails loud if missing)
affects: [02-08 (wires ConvexProviderWithAuth + login gate into main.tsx/AppShell using these three exports)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "@convex-dev/workos is not installed — ConvexProviderWithAuth's documented custom-auth escape hatch is used directly, because that package hard-depends on @workos-inc/authkit-react (browser-managed token), incompatible with the janja main-process/IPC token flow"
    - "AuthUser type is duplicated locally in useAuth.ts rather than imported from src/main/auth/types.ts — src/main is outside tsconfig.web.json's include glob, so cross-process type imports don't resolve cleanly; same compromise the official WorkOS Electron example makes"
    - "useConvexAuthAdapter wraps useAuth() and is a pure re-shaping hook (useMemo over isLoading/isAuthenticated/fetchAccessToken) — never touches window.auth directly except inside fetchAccessToken, which always resolves to string | null and never throws out"

key-files:
  created:
    - src/renderer/src/hooks/useAuth.ts
    - src/renderer/src/hooks/useConvexAuthAdapter.ts
    - src/renderer/src/lib/convex-client.ts
  modified: []

key-decisions:
  - "Followed the plan's code near-verbatim for both tasks — no deviations needed."
  - "Verified the ConvexProviderWithAuth useAuth contract directly against the installed convex@1.44.0 package types (node_modules/convex/dist/esm-types/react/ConvexAuthState.d.ts), not just against 02-RESEARCH.md — confirmed byte-for-byte match: { isLoading: boolean; isAuthenticated: boolean; fetchAccessToken: (args: { forceRefreshToken: boolean }) => Promise<string | null> }."
  - "Did not add an ImportMetaEnv augmentation for VITE_CONVEX_URL in env.d.ts — vite/client.d.ts's ImportMetaEnv already extends Record<string, any> as a fallback, so import.meta.env.VITE_CONVEX_URL type-checks without it. Left env.d.ts untouched (not in this plan's files_modified list)."

patterns-established:
  - "Renderer-side auth hooks live under src/renderer/src/hooks/, isolated from the shell component tree (src/renderer/src/components/shell/**) which plan 02-08 owns — this plan exports a clean interface (useAuth, useConvexAuthAdapter, convexClient) and stops before any wiring or UI."

# Metrics
duration: ~15min
completed: 2026-08-18
---

# Phase 02 Plan 07: Renderer Auth Hook Summary

**Hand-written `ConvexProviderWithAuth` adapter (`useConvexAuthAdapter`) bridging `window.auth` IPC state into the exact `{ isLoading, isAuthenticated, fetchAccessToken }` contract Convex's client requires, plus the `useAuth` hook and `ConvexReactClient` singleton it depends on — no `@convex-dev/workos`, no UI wiring yet.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-08-18
- **Tasks:** 2/2
- **Files modified:** 3 (all created, none modified)

## Accomplishments
- `src/renderer/src/hooks/useAuth.ts`: React hook consuming `window.auth` — calls `getUser()` on mount, subscribes to `onAuthChange`, exposes `{ user, loading, signIn, signOut }`. `AuthUser` is redefined locally (not imported from `src/main/auth/types.ts`) since `src/main` sits outside `tsconfig.web.json`'s `include` glob.
- `src/renderer/src/hooks/useConvexAuthAdapter.ts`: wraps `useAuth()`, returns exactly the shape `ConvexProviderWithAuth`'s `useAuth` prop requires — `isLoading` (from `loading`), `isAuthenticated` (`!!user`), and `fetchAccessToken` (calls `window.auth.getAccessToken({ forceRefreshToken })`, catches and returns `null` on any rejection so it never throws out of the callback). Memoized with `useMemo`/`useCallback` so referential identity is stable across re-renders unless `user`/`loading` actually change.
- `src/renderer/src/lib/convex-client.ts`: `ConvexReactClient` singleton reading `import.meta.env.VITE_CONVEX_URL`. Throws immediately at module-evaluation time (not silently) if the env var is missing or empty, with a message pointing at `.env.local.example` and the 02-04 checkpoint.

## Task Commits

Per explicit `NO_GIT` instruction in this agent's task (sibling agents run concurrently in the same worktree; the orchestrator commits in series), **no git commits were made**. All three files are written to disk and left uncommitted.

1. **Task 1: Hook useAuth sobre window.auth** — `src/renderer/src/hooks/useAuth.ts` written, not committed.
2. **Task 2: Cliente Convex e adaptador para ConvexProviderWithAuth** — `src/renderer/src/lib/convex-client.ts`, `src/renderer/src/hooks/useConvexAuthAdapter.ts` written, not committed.

## Files Created/Modified
- `src/renderer/src/hooks/useAuth.ts` - React hook over `window.auth`, local `AuthUser` type mirroring `src/main/auth/types.ts`
- `src/renderer/src/hooks/useConvexAuthAdapter.ts` - adapter translating `useAuth()` into `ConvexProviderWithAuth`'s exact `useAuth` contract
- `src/renderer/src/lib/convex-client.ts` - singleton `ConvexReactClient`, fails loud on missing `VITE_CONVEX_URL`

## Decisions Made
See `key-decisions` in frontmatter above. No architectural deviations — the plan's exact code shapes were used verbatim. The one point of independent verification beyond the plan/research doc: the `ConvexProviderWithAuth` `useAuth` contract was checked against the actually-installed `convex@1.44.0` package's own `.d.ts` files (not trusted from 02-RESEARCH.md alone, per this task's explicit instruction) — confirmed to match exactly.

## Deviations from Plan

None — plan executed exactly as written. Both files/tasks match the plan's specified shapes (function names, hook signatures, contract fields) verbatim.

## Issues Encountered
A transient `npm run typecheck:convex` failure (`Property 'glob' does not exist on type 'ImportMeta'` in `convex/presence.test.ts` and `convex/users.test.ts`) was observed on one intermediate run of `npm run build`. This is in `convex/`, owned by sibling agents (02-05/02-06) working concurrently in the same worktree — not touched by this plan. A subsequent run (after their concurrent edit presumably landed) showed `npm run typecheck` and `npm run build` both passing clean with no errors anywhere, including `convex/`. No fix was made or needed on this agent's side.

## User Setup Required
None from this plan. `VITE_CONVEX_URL` must already be set in `.env.local` (per 02-04's checkpoint) for `convex-client.ts` to construct successfully at runtime — unchanged by this plan, just consumed by it.

## What I verified vs. what I only wrote

**Verified by running:**
- `npm run typecheck:web` — passes clean, no errors, immediately after creating all three files.
- `npm run typecheck` (node + web + convex) — passes clean on a clean run.
- `npm run build` — full `electron-vite build` (main, preload, renderer) succeeds; `out/main/index.js`, `out/preload/index.js`, `out/renderer/*` all produced.
- Read the installed `convex@1.44.0` package's own type declarations (`node_modules/convex/dist/esm-types/react/ConvexAuthState.d.ts`) directly, confirming `ConvexProviderWithAuth`'s `useAuth` prop type matches `useConvexAuthAdapter`'s return shape exactly, field-for-field.
- Confirmed via `git status --short` that only `src/renderer/src/hooks/` (new dir) and `src/renderer/src/lib/convex-client.ts` were added — no files under `convex/`, `src/main/`, `src/preload/`, or `src/renderer/src/components/shell/**` were touched.
- Confirmed `import.meta.env.VITE_CONVEX_URL` type-checks without any `env.d.ts` change, by reading `node_modules/vite/types/importMeta.d.ts` (`ImportMetaEnv extends Record<ImportMetaEnvFallbackKey, any>` — a permissive fallback index signature covers any `VITE_*` key without explicit augmentation).

**NOT verified (cannot be, from this Linux sandbox / without a real Convex+WorkOS round trip):**
- No component ever renders `useAuth()` or `useConvexAuthAdapter()` yet — there's no `ConvexProviderWithAuth` in the tree (that's 02-08's job), so neither hook has been exercised against a live `window.auth` IPC bridge or a live Convex deployment. Everything here is verified by type-checking and reading, not by running React in a browser/Electron window.
- `fetchAccessToken`'s catch-and-return-null behavior on `window.auth.getAccessToken` rejection has not been exercised against a real rejected promise (e.g., expired refresh token, corrupted `safeStorage` session) — only read/reasoned about.
- `convex-client.ts`'s thrown error on missing `VITE_CONVEX_URL` was not triggered by an actual empty `.env.local` and a real `npm run dev` boot — only confirmed by reading the code and the Vite env-typing chain.
- The known `get-convex/convex-backend#259` latch bug (`isAuthenticated` sticking at `false` after token expiry) is explicitly **not** addressed by this plan — its defense (local logging + last-resort silent `BrowserWindow.reload()`) is scoped to plan 02-08 (confirmed by reading `02-08-login-gate-e-integracao-PLAN.md`, which already specifies an `[auth-watchdog]` log + reload mitigation). This plan's `useConvexAuthAdapter` only surfaces `isAuthenticated`/`isLoading` faithfully; it does not itself watch for the latch or trigger any reload.

## Next Phase Readiness
- `useAuth`, `useConvexAuthAdapter`, and `convexClient` are all exported, type-complete, and ready for 02-08 to import into `main.tsx`/`AppShell` and wrap the app with `<ConvexProviderWithAuth client={convexClient} useAuth={useConvexAuthAdapter}>`.
- No UI or wiring exists yet — by design, per this plan's `<success_criteria>`. 02-08 owns the login gate, the `[auth-watchdog]` reload defense against the Convex latch bug, and integration into `src/renderer/src/components/shell/**`.
- All three files are left uncommitted per `NO_GIT`; the orchestrator will commit these in series with sibling agents' work.

---
*Phase: 02-convex-auth-workos*
*Completed: 2026-08-18*
