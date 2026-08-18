---
phase: 02-convex-auth-workos
plan: 08
subsystem: auth
tags: [react, convex, workos, electron, contextbridge, react-hooks-purity]

# Dependency graph
requires:
  - phase: 02-convex-auth-workos (plan 05)
    provides: "convex/users.ts (ensureUser mutation)"
  - phase: 02-convex-auth-workos (plan 06)
    provides: "convex/presence.ts (heartbeat mutation)"
  - phase: 02-convex-auth-workos (plan 07)
    provides: "useAuth, useConvexAuthAdapter, convexClient (renderer hooks + Convex client singleton)"
provides:
  - "Complete renderer auth tree: ConvexProviderWithAuth > AuthWatchdog + AuthGate(> PresenceHeartbeat + App)"
  - "src/renderer/src/features/auth/LoginScreen.tsx (minimal 'Entrar com Google' screen)"
  - "src/renderer/src/features/auth/AuthGate.tsx (login/app gate, calls ensureUser once per authenticated transition)"
  - "src/renderer/src/features/auth/AuthWatchdog.tsx (Pitfall 4 mitigation: log + silent reload)"
  - "src/renderer/src/features/auth/PresenceHeartbeat.tsx (45s heartbeat while authenticated)"
  - "convex/_generated/api.ts (hand-written codegen artifact, matches official convex codegen template output for the current convex/ function set)"
affects: ["02-09 (final Windows human verification of AUTH-01..06)", "phase 03 (shell will eventually consume useAuth/window.auth for user identity display + a real logout affordance)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Adjusting state during render (not in useEffect) for AuthWatchdog's isAuthenticated-transition tracking — follows React's documented 'adjusting state when a prop changes' pattern instead of a setState-in-effect pattern, because this codebase's eslint-plugin-react-hooks config (v6, React Compiler-aligned rules) flags react-hooks/set-state-in-effect and react-hooks/purity (no Date.now() during render) as hard errors, not warnings"
    - "Guard flags that exist only to prevent duplicate side-effect calls (ensureUser dedup in AuthGate) use useRef, not useState — no re-render is needed to observe them, and using state there would itself trip react-hooks/set-state-in-effect"
    - "Any component that must live inside main.tsx's render tree but needs Fast Refresh (react-refresh/only-export-components) gets its own file under src/renderer/src/features/auth/ — main.tsx now only composes providers, no component definitions"

key-files:
  created:
    - src/renderer/src/features/auth/LoginScreen.tsx
    - src/renderer/src/features/auth/AuthGate.tsx
    - src/renderer/src/features/auth/AuthWatchdog.tsx
    - src/renderer/src/features/auth/PresenceHeartbeat.tsx
    - convex/_generated/api.ts
  modified:
    - src/renderer/src/main.tsx

key-decisions:
  - "Created convex/_generated/api.ts by hand, reproducing the literal output of convex's own codegen template (node_modules/convex/src/cli/codegen_templates/api.ts, TypeScript combined-file variant) for the current convex/ function set (lib/tag.ts, presence.ts, users.ts, sorted per the same compareModulePaths the CLI uses) — not invented from memory. This follows the precedent explicitly left by 02-05/02-06 (both hand-wrote convex/_generated/dataModel.ts and server.ts the same way, and explicitly declined to write api.ts, leaving it for whichever plan needed it first). This worktree has no CONVEX_DEPLOYMENT credentials (confirmed: npx convex codegen fails with 'No CONVEX_DEPLOYMENT set'), so npx convex dev/codegen could not be run for real. When npx convex dev runs for real on the Windows machine (02-09), it will regenerate this file from the live deployment — expected and harmless, content already matches for the current schema."
  - "Rewrote AuthGate's ensureUser dedup guard from useState to useRef: the plan's literal code (`if (!isAuthenticated) setEnsured(false)`) is flagged by eslint-plugin-react-hooks's set-state-in-effect rule as an unconditional setState inside an effect body. Since the 'ensured' flag never needs to trigger a re-render (only isAuthenticated/isLoading drive what's rendered), a ref is both simpler and correct — no behavior change, same 'ensureUser called at most once per authenticated transition' guarantee."
  - "Rewrote AuthWatchdog's droppedAt tracking from useRef (read inside a second useEffect's dependency array) to useState, computed via React's 'adjusting state when a prop changes' render-time pattern instead of inside a useEffect body: the plan's literal code had a real bug (not just a lint nit) — mutating a ref inside effect 1 and reading `ref.current` in effect 2's dependency array captures the ref's value from *before* the mutation on that same render (refs don't trigger re-renders), so effect 2 would in practice never observe the transition reliably and the reload timer could fail to arm. Switching to state fixes this. Date.now() itself was dropped entirely (react-hooks/purity forbids impure calls during render, and the timestamp value was never read anywhere except as a null-vs-non-null flag) — replaced with a plain boolean `dropped` state, functionally identical for this component's purpose."
  - "Extracted PresenceHeartbeat into its own file (src/renderer/src/features/auth/PresenceHeartbeat.tsx) instead of defining it inline in main.tsx as the plan's literal code did — eslint's react-refresh/only-export-components rule flags a file that both bootstraps the React root (createRoot/render) and exports a component. main.tsx is now provider composition only, matching the plan's own stated intent to keep main.tsx minimal."
  - "Did not add the optional '@convex/*' tsconfig path alias the plan mentions as a fallback — the plan's literal relative import paths (`../../../../../convex/_generated/api` from features/auth/, `../../../convex/_generated/api` from main.tsx) are correct as written for the actual directory depths (verified by npm run typecheck:web passing), so the simpler option (no tsconfig/vite-alias changes needed) was used."
  - "No logout button/UI was added anywhere in the render tree. The plan's task list (Task 1: LoginScreen+AuthGate, Task 2: main.tsx wiring+heartbeat, Task 3: AuthWatchdog) never asked for one, and per the plan's explicit constraint, components/shell/** (Fase 3's territory) was not touched. useAuth's signOut is fully wired and functional, just not exposed by any clickable UI element yet. See 'What the user must test on Windows' below for the DevTools console workaround needed for 02-09's AUTH-05 (logout) check."

patterns-established:
  - "src/renderer/src/features/auth/ is now the home for all auth-related renderer components that are NOT part of components/shell/** (Fase 3): LoginScreen, AuthGate, AuthWatchdog, PresenceHeartbeat. Future auth-adjacent UI (e.g. a real logout button, once Fase 3 wires it into the shell) should either live here or import from here."

# Metrics
duration: ~45min
completed: 2026-08-18
---

# Phase 02 Plan 08: Login Gate e Integração Summary

**Wires the complete renderer auth tree end-to-end (ConvexProviderWithAuth → AuthWatchdog + AuthGate → PresenceHeartbeat + existing Fase 3 App), hand-writes the missing `convex/_generated/api.ts` codegen artifact that blocked every `api.*` import in this worktree, and fixes two real correctness bugs in the plan's own literal watchdog/gate code (a stale-ref dependency-array bug and an impure-render Date.now() call) surfaced by the repo's strict `eslint-plugin-react-hooks` config — App.tsx and components/shell/** untouched.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-08-18
- **Tasks:** 3/3
- **Files modified:** 6 (5 created, 1 modified)

## Accomplishments

- `src/renderer/src/features/auth/LoginScreen.tsx`: minimal but real login screen — "Entrar com Google" button (shadcn `Button`), disabled + "Abrindo o navegador…" while pending, inline error message on failure. Uses only `useAuth()` and `@/components/ui/button`, never touches `components/shell/**`.
- `src/renderer/src/features/auth/AuthGate.tsx`: the portão — renders a loading state while `isLoading`, `LoginScreen` while `!isAuthenticated`, and `children` (which is `<App />` from `main.tsx`) once authenticated. Calls `ensureUser` exactly once per true authenticated transition via a `useRef` dedup guard (not `useState`, to avoid an eslint `set-state-in-effect` violation and an unnecessary re-render).
- `src/renderer/src/features/auth/AuthWatchdog.tsx`: Pitfall 4 (`get-convex/convex-backend#259`) mitigation. Tracks whether the session was ever authenticated this renderer-process lifetime; on an unexpected `true→false` transition, logs `[auth-watchdog] isAuthenticated caiu inesperadamente para false…` and arms a 15s timer. When the timer fires, it calls `window.auth.getUser()` to confirm the main process still considers the session valid (avoids reload-looping on a deliberate logout) and, if so, performs a silent `window.location.reload()`.
- `src/renderer/src/features/auth/PresenceHeartbeat.tsx`: calls `api.presence.heartbeat` immediately on becoming authenticated, then every 45s, cleaned up on unmount/logout.
- `src/renderer/src/main.tsx`: now composes `ConvexProviderWithAuth` (using `convexClient` + `useConvexAuthAdapter` from 02-07) around `AuthWatchdog` + `AuthGate` (wrapping `PresenceHeartbeat` + the untouched `<App />`). `App.tsx` byte-for-byte unchanged.
- `convex/_generated/api.ts`: hand-written, matching the official `npx convex codegen` TypeScript-combined-file template output exactly for the current `convex/` function set (`lib/tag.ts`, `presence.ts`, `users.ts`) — this file did not exist before this plan (02-05/02-06 both explicitly declined to create it and left a note that whoever needed `api.*` imports first should write it).

## Task Commits

Per explicit `NO_GIT` instruction in this agent's task (other agents share this worktree; the orchestrator commits in series), **no git commits were made**. All files are written to disk and left uncommitted.

1. **Task 1: Tela de login mínima e portão de autenticação** — `LoginScreen.tsx`, `AuthGate.tsx` written, not committed.
2. **Task 2: Wiring em main.tsx e heartbeat de presença** — `main.tsx` rewritten, `PresenceHeartbeat.tsx` written (extracted from the plan's inline version), not committed.
3. **Task 3: Vigia de isAuthenticated (mitigação Pitfall 4)** — `AuthWatchdog.tsx` written (with a state-based rewrite of the plan's ref-based design, see Deviations), not committed.

Also written, not committed: `convex/_generated/api.ts` (Rule 3, blocking — see Deviations).

## Files Created/Modified

- `src/renderer/src/features/auth/LoginScreen.tsx` - minimal login screen, "Entrar com Google" button via `useAuth().signIn()`
- `src/renderer/src/features/auth/AuthGate.tsx` - login/app gate + one-shot `ensureUser` call per authenticated transition
- `src/renderer/src/features/auth/AuthWatchdog.tsx` - Pitfall 4 mitigation: log on unexpected auth drop + silent reload fallback
- `src/renderer/src/features/auth/PresenceHeartbeat.tsx` - 45s presence heartbeat while authenticated (extracted from main.tsx)
- `src/renderer/src/main.tsx` - now composes `ConvexProviderWithAuth > AuthWatchdog + AuthGate(> PresenceHeartbeat + App)`; `App.tsx` itself not touched
- `convex/_generated/api.ts` - hand-written codegen artifact (see Deviations, Rule 3)

## Decisions Made

See `key-decisions` in frontmatter above. Summary: followed the plan's literal code shapes for `LoginScreen`/`AuthGate`/wiring, but rewrote `AuthGate`'s dedup guard (ref instead of state) and `AuthWatchdog`'s drop-tracking (state instead of ref, boolean instead of timestamp) to fix real correctness/lint issues; extracted `PresenceHeartbeat` to its own file; hand-wrote the missing `convex/_generated/api.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `convex/_generated/api.ts` did not exist**

- **Found during:** Task 1, before writing `AuthGate.tsx` (which the plan specifies must `import { api } from '../../../../../convex/_generated/api'`).
- **Issue:** Only `convex/_generated/dataModel.ts` and `convex/_generated/server.ts` existed (hand-written by 02-05/02-06). Neither sibling plan wrote `api.ts`, both explicitly noting in their summaries that they left it for whoever needed `api.*` imports first — that's this plan.
- **Fix:** Read `node_modules/convex/src/cli/codegen_templates/api.ts` (the actual template `npx convex codegen` uses) and `node_modules/convex/src/bundler/index.ts`'s `entryPoints()` function (to determine which `convex/` files count as function modules — excludes `_generated/`, `schema.ts`, and any file with multiple dots in its basename like `auth.config.ts`/`*.test.ts`). Reproduced the TypeScript combined-file variant of the template verbatim for the 3 resulting modules (`lib/tag.ts`, `presence.ts`, `users.ts`, sorted via the same `compareModulePaths` logic the CLI uses).
- **Files modified:** `convex/_generated/api.ts` (created).
- **Verification:** `npm run typecheck` (node+web+convex) and `npm run build` both pass; `npx vitest run` (12 tests across `convex/lib/tag.test.ts`, `convex/users.test.ts`, `convex/presence.test.ts`) all pass unaffected.
- **Note for whoever reviews:** the next time `npx convex dev` runs for real with credentials (the Windows machine, 02-09), it will regenerate this file from the live deployment. That's expected and harmless — content already matches what the CLI would produce for the current schema.

**2. [Rule 1 - Bug] `AuthWatchdog`'s ref-based drop-tracking would not reliably arm the reload timer**

- **Found during:** Task 3, running `npx eslint` against the newly-written file (proactive check beyond the plan's stated verification, since the plan's own literal code was suspicious on inspection).
- **Issue:** The plan's literal code stored `droppedAt` in a `useRef` and read `droppedAt.current` in a second `useEffect`'s dependency array. Refs mutated inside an effect body don't trigger re-renders, and a dependency array is evaluated at render time — *before* that render's effects run. So the second effect's dependency array would, in practice, almost always still see the ref's pre-mutation value and never reliably observe the `true→false` transition; the 15s reload timer could silently fail to arm. `eslint-plugin-react-hooks`'s `react-hooks/refs` rule also flagged this exact line as an error ("Cannot access refs during render").
- **Fix:** Replaced the `droppedAt: number | null` ref with `dropped: boolean` state, and moved the transition-detection logic to run during render (not inside a `useEffect`), following React's documented "adjusting state when a prop changes" pattern. The reload-timer `useEffect` (a genuine side effect: `setTimeout` + `window.auth.getUser()` IPC call + conditional `window.location.reload()`) still lives in `useEffect`, now correctly keyed on the `dropped` boolean.
- **Files modified:** `src/renderer/src/features/auth/AuthWatchdog.tsx`.
- **Verification:** `npx eslint` on the file is clean (0 errors, 0 warnings); `npm run typecheck` and `npm run build` pass.

**3. [Rule 1 - Bug/Lint] `AuthWatchdog`'s `Date.now()` call during render, and `AuthGate`'s `setEnsured(false)` inside an effect body, both violate this repo's `eslint-plugin-react-hooks` config**

- **Found during:** Task 1 and Task 3, running `npx eslint` proactively against all new files.
- **Issue:** This repo's eslint config includes `react-hooks/set-state-in-effect` (flags synchronous `setState` calls directly in an effect body, outside a subscription callback) and `react-hooks/purity` (flags impure calls like `Date.now()` during render) as hard errors, not warnings. The plan's literal code for both `AuthGate` (`if (!isAuthenticated) setEnsured(false)` inside `useEffect`) and the intermediate fix for `AuthWatchdog` (calling `Date.now()` inside the render-time transition-adjustment block) tripped these rules.
- **Fix:** `AuthGate`'s `ensured` flag became a `useRef` (no render dependency on it, so no state/effect interaction needed at all — see Deviation 2's sibling fix above, folded into the same file). `AuthWatchdog`'s stored value became a plain boolean (`dropped`) instead of a `Date.now()` timestamp, since the timestamp's actual value was never read anywhere — only whether the drop had already been recorded.
- **Files modified:** `src/renderer/src/features/auth/AuthGate.tsx`, `src/renderer/src/features/auth/AuthWatchdog.tsx`.
- **Verification:** `npx eslint src/renderer/src/features/auth src/renderer/src/main.tsx convex/_generated/api.ts` → 0 errors, 0 warnings, confirmed by direct re-run after each fix.

**4. [Rule 1 - Lint] `main.tsx`'s inline `PresenceHeartbeat` component definition breaks Fast Refresh**

- **Found during:** Task 2, running `npx eslint` against `main.tsx`.
- **Issue:** `react-refresh/only-export-components` flags a file that both defines a React component and performs the `createRoot(...).render(...)` bootstrap call — Fast Refresh can't reliably hot-reload such a file.
- **Fix:** Extracted `PresenceHeartbeat` into its own file, `src/renderer/src/features/auth/PresenceHeartbeat.tsx`, imported into `main.tsx`. `main.tsx` is now provider composition only — arguably *more* aligned with the plan's own stated intent ("preservando o `createRoot`/`StrictMode`... já existentes") than the plan's literal inline version.
- **Files modified:** `src/renderer/src/main.tsx` (component removed), `src/renderer/src/features/auth/PresenceHeartbeat.tsx` (created).
- **Verification:** `npx eslint` clean; `npm run build` produces the same 3 output bundles (`out/main`, `out/preload`, `out/renderer`) as before.

None of these deviations changed the plan's `must_haves.truths`/`artifacts`/`key_links` — all four are still true and present exactly as the plan's frontmatter specifies (verified below).

## Issues Encountered

- This Linux worktree has no `.env.local` / `CONVEX_DEPLOYMENT` (confirmed consistent with 02-05/02-06/02-07's summaries — those credentials only exist on the Windows machine per the 02-04 checkpoint). This means `npm run dev` was not run end-to-end against a live Convex deployment + real WorkOS OAuth flow from this agent — only `npm run typecheck`, `npm run build`, and `npx vitest run` (which covers `convex/` unit tests via `convex-test`, not the renderer auth flow) could be verified here. The actual login/persistence/watchdog/heartbeat behavior against a real backend is exactly what 02-09 exists to verify on Windows.
- No logout UI element exists anywhere in the render tree yet (see key-decisions above) — `useAuth().signOut` is wired and functional but nothing calls it from a click handler. This is a real gap for 02-09's AUTH-05 check; see "What the user must test on Windows" below for the exact DevTools console workaround.

## What I verified vs. what I only wrote

**Verified by running, in this Linux worktree:**

- `npm run typecheck` (node + web + convex) — passes clean, 0 errors.
- `npm run build` (full `electron-vite build`: main, preload, renderer) — succeeds, produces `out/main/index.js`, `out/preload/index.js`, `out/renderer/*`.
- `npx vitest run` — 12/12 tests pass across `convex/lib/tag.test.ts`, `convex/users.test.ts`, `convex/presence.test.ts` (unaffected by this plan's changes, run to confirm no regression).
- `npx eslint` on every new/modified file (`src/renderer/src/features/auth/*.tsx`, `src/renderer/src/main.tsx`, `convex/_generated/api.ts`) — 0 errors, 0 warnings, after the fixes documented in Deviations. (`npm run lint` across the whole repo shows pre-existing errors/warnings in files this plan never touched — `components/ui/*`, `state/selection-context.tsx`, `vitest.config.ts` — confirmed by grepping the lint output for this plan's file paths: no matches.)
- `git status --short` — confirms `src/renderer/src/App.tsx` was never touched, and only `src/renderer/src/main.tsx` (modified), `src/renderer/src/features/` (new dir), and `convex/_generated/api.ts` (new file) changed. No files under `components/shell/**`, `src/main/`, or `src/preload/` were touched.

**NOT verified (cannot be, from this Linux sandbox without a real Convex+WorkOS+Electron round trip):**

- The actual OAuth loopback flow (clicking "Entrar com Google", system browser opening, redirect back into the app).
- `ensureUser` actually running against a live Convex deployment and generating a real `username#tag`.
- `AuthWatchdog`'s reload behavior against a real access-token expiry (or Pitfall 4 reproduction).
- `PresenceHeartbeat` actually writing to the `presence` table on a live deployment.
- Electron's `window.auth` IPC bridge (preload) being exercised for real — everything here is type-checked and read, not run inside an actual `BrowserWindow`.

All of the above are exactly what 02-09 (Windows checkpoint) exists to verify.

## What the user must test on Windows (for 02-09)

02-09's own script already covers this well; the one addition needed given this plan's scope (no logout UI added) is spelled out in point 5 below.

Preparation: `git pull`, `npm install`, confirm `.env.local` has `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`, `MAIN_VITE_WORKOS_CLIENT_ID` (from 02-04). Run `npx convex dev` in one terminal (leave running — this will regenerate `convex/_generated/*` from the live deployment, which is expected), `npm run dev` in another.

1. **AUTH-01 (login):** With the app open and no saved session, click "Entrar com Google" on the login screen. Expected: the system's default browser opens (never an in-app window), you authenticate with a real Google account, and the app automatically returns to an authenticated state (login screen disappears, the shell renders) within ~15 seconds, with no manual copy/paste of any code.
2. **AUTH-06 (identity):** After the first login, open DevTools (F12) and run `await window.auth.getUser()` in the console. Expected: an object with `workosId`, `email`, and other fields — and separately, `ensureUser` should have created a `users` document with a generated `username`+`tag` (visible via the Convex dashboard's Data tab for the `users` table, since no UI in this plan surfaces it visually yet — that's Fase 3's job).
3. **AUTH-02 (persistence):** Close the app entirely and reopen it. Expected: it returns to the authenticated state directly, no login screen, no re-prompt.
4. **AUTH-03 (corrupted credential):** Close the app; locate and delete/corrupt `auth-session.enc` (path is `%APPDATA%/<app-name>/auth-session.enc` — confirm the exact folder name from `app.getPath('userData')` during the test, since it depends on the packaged app name). Reopen the app. Expected: it falls back to the login screen cleanly — no crash, no blank/white window.
5. **AUTH-05 (logout):** Log in again. **This plan did not add a logout button to the UI** (out of scope — `components/shell/**` is Fase 3's territory, and no task in 02-08 asked for one). To trigger logout for this test, open DevTools (F12) and run `await window.auth.signOut()` in the console. Expected: the app returns to the login screen (`AuthGate` reacts to the `onAuthChange` IPC event the same way it would from a real UI button), and a subsequent login attempt via "Entrar com Google" works normally afterward. If a proper logout button is desired before shipping, that should be scheduled as Fase 3/4 shell work, not re-opened here.
6. **AUTH-04 (long session / Pitfall 4 mitigation):** Log in again, leave the app open and running (can be minimized) for at least 30 minutes — simulates a long voice-call session. Afterward, interact with the app again (anything that triggers a Convex query/mutation) and confirm it isn't stuck unauthenticated. Watch the DevTools console (F12) throughout for any `[auth-watchdog]` log lines:
   - If none appear: the 8h WorkOS access-token TTL simply didn't expire during the 30-minute window — this is a pass by absence (the bug's precondition, token expiry, never fired). To force a stricter test of the watchdog logic itself, this would require temporarily lowering the WorkOS access-token TTL in the dashboard back down for one test run, then restoring it to 8h afterward — optional, not required for 02-09 to pass.
   - If `[auth-watchdog] isAuthenticated caiu inesperadamente para false...` appears: confirm the app recovers on its own (an automatic `window.location.reload()`, visible as the window flashing/reloading) within ~15 seconds of that log line, with no manual intervention, and that after the reload the app is authenticated again.

## Next Phase Readiness

- The renderer auth tree is fully composed and wired: `ConvexProviderWithAuth > AuthWatchdog + AuthGate(> PresenceHeartbeat + App)` in `src/renderer/src/main.tsx`.
- `App.tsx` and everything under `components/shell/**` are untouched — Fase 3's work is preserved byte-for-byte, and the shell now renders behind the auth gate rather than unconditionally.
- `convex/_generated/api.ts` exists and is importable; every future plan needing `api.*` (Fase 4 onward) can import it directly, though it will be regenerated for real (and should match) once `npx convex dev` runs with real credentials.
- Only remaining gap before Fase 2 is fully closed: 02-09, the human Windows verification checkpoint. This plan is autonomous and does not perform that verification itself.
- Fase 3/4 will eventually want a real logout affordance and a real (non-DevTools) way to display `username#tag` inside the shell — flagged above, not built here since it was out of this plan's explicit scope.

---
*Phase: 02-convex-auth-workos*
*Completed: 2026-08-18*
