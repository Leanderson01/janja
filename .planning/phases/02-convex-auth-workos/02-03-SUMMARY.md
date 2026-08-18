---
phase: 02-convex-auth-workos
plan: 03
subsystem: auth
tags: [electron, ipc, contextbridge, custom-protocol, workos, oauth, main-process]

# Dependency graph
requires:
  - phase: 02-convex-auth-workos (plan 02)
    provides: src/main/auth/auth.ts (getSignInUrl, handleCallback, getAccessToken, getUser, clearSession, getLogoutUrl), src/main/auth/types.ts (AUTH_CHANNELS, AuthUser, AuthIpcResult)
provides:
  - src/main/auth/deep-link-handler.ts (registerProtocol, extractCallbackUrl, parseCallbackParams)
  - src/main/auth/ipc-handlers.ts (setupAuthIpcHandlers, notifyAuthChange)
  - src/main/index.ts extended: janja:// protocol registration, second-instance argv parsing wired to handleCallback, IPC handlers wired, session restore on startup
  - window.auth typed API in renderer (signIn, signOut, getUser, getAccessToken, onAuthChange)
affects: [02-07 (ConvexProviderWithAuth/renderer auth hook consumes window.auth), any Fase 9 packaging work touching registerProtocol]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "second-instance handler signature changed from () => {} to (_event, argv) => {} — argv carries the janja:// callback URL on Windows, this is the only delivery path since there is no open-url event on that platform"
    - "contextBridge exposes window.auth as a fourth global alongside window.electron/window.api, same if (process.contextIsolated) guard, never exposes ipcRenderer directly"
    - "IPC handlers (ipc-handlers.ts) are a thin translation layer only — all OAuth/session logic stays in auth.ts (02-02), ipc-handlers.ts never touches WorkOS SDK or safeStorage directly"

key-files:
  created:
    - src/main/auth/deep-link-handler.ts
    - src/main/auth/ipc-handlers.ts
  modified:
    - src/main/index.ts
    - src/preload/index.ts
    - src/preload/index.d.ts

key-decisions:
  - "Followed the plan's code near-verbatim for all four files — no deviations needed."
  - "registerProtocol() called immediately after requestSingleInstanceLock() is granted (in the else branch, before app.on('second-instance', ...)), matching the plan's requirement that it run before app.whenReady() resolves and only on the primary instance."
  - "second-instance handler keeps the exact F0 focus/restore logic untouched, only adds the argv-based callback extraction after it — no F0 behavior removed."
  - "Session restore on startup (getUser() + notifyAuthChange) is deferred to mainWindow.webContents.once('did-finish-load', ...) rather than firing right after createWindow(), so the renderer's onAuthChange listener is guaranteed to be mounted before the event is sent — otherwise a session restored before React mounts would be silently dropped."
  - "Did not implement macOS open-url as a functional path (PROJECT.md targets Windows only) — not even a stub listener was added, per the plan's explicit instruction not to spend time on that path."

patterns-established:
  - "Deep-link handler is a pure-function module (registerProtocol/extractCallbackUrl/parseCallbackParams) with zero window/app-instance state — testable by reading, matches the pattern already set by auth.ts in 02-02."
  - "index.ts wiring is strictly additive: new imports, one new call (registerProtocol), one changed listener signature (second-instance), one new block inside whenReady (setupAuthIpcHandlers + did-finish-load restore) — no restructuring of the F0 bootstrap."

# Metrics
duration: ~20min
completed: 2026-08-18
---

# Phase 02 Plan 03: Main Process Protocol + IPC Summary

**Wires the 02-02 OAuth core into the Electron shell: `janja://` registered as the default protocol client (dev and packaged paths), the existing F0 `second-instance` handler extended to extract and validate the OAuth callback URL from `argv`, four IPC channels exposed, and a typed `window.auth` bridged into the renderer via contextBridge.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-18
- **Tasks:** 2/2
- **Files modified:** 4 (2 created, 2 modified — plus src/main/index.ts as a 3rd modified file: 4 modified total, 2 created)

## Accomplishments
- `src/main/auth/deep-link-handler.ts`: `registerProtocol()` (handles the `process.defaultApp` dev-vs-packaged split for `app.setAsDefaultProtocolClient`), `extractCallbackUrl(argv)`, `parseCallbackParams(url)` — all pure functions, no side effects beyond the one OS registration call.
- `src/main/auth/ipc-handlers.ts`: `setupAuthIpcHandlers(mainWindow)` registers `auth:sign-in` (opens system browser via `shell.openExternal`, never a `BrowserWindow`), `auth:sign-out`, `auth:get-user`, `auth:get-access-token`; `notifyAuthChange(mainWindow, user)` pushes `auth:on-auth-change` to the renderer.
- `src/main/index.ts`: additive wiring only —
  - `registerProtocol()` called right after `requestSingleInstanceLock()` is granted, before `whenReady()`.
  - `second-instance` handler signature changed to `(_event, argv) =>` (was `() =>`); F0's focus/restore logic is untouched; new code extracts the callback URL, validates `state`/`code`/`error`, calls `handleCallback(code, state)`, and on success calls `notifyAuthChange`. Errors (invalid state, expired login, WorkOS rejecting the code) are logged to console and swallowed — never crash the app.
  - Inside `whenReady().then(...)`, after `createWindow()`, `setupAuthIpcHandlers(mainWindow)` is called, and `mainWindow.webContents.once('did-finish-load', ...)` restores any existing persisted session by calling `getUser()` and notifying the renderer.
  - `requestSingleInstanceLock`, `contextIsolation: true`, `nodeIntegration: false`, and F3's `minWidth`/`minHeight` are all still present and unchanged (verified by grep, see Verification below).
- `src/preload/index.ts` / `src/preload/index.d.ts`: `window.auth` exposed via `contextBridge.exposeInMainWorld('auth', authApi)` in the same `if (process.contextIsolated)` block as the existing `electron`/`api` globals — `authApi` wraps `ipcRenderer.invoke`/`ipcRenderer.on` calls only for the four named `auth:*` channels; `ipcRenderer` itself is never exposed on `window`. Types declared in `index.d.ts` via `AuthApi` interface, importing `AuthUser` from `../main/auth/types`.

## Task Commits

Per explicit `NO_GIT` instruction in this agent's task (sibling agents run concurrently in the same worktree; the orchestrator commits in series), **no git commits were made**. All files are written to disk and left uncommitted.

1. **Task 1: Registro do protocolo janja:// e parsing do callback** — `src/main/auth/deep-link-handler.ts` written, not committed.
2. **Task 2: IPC, wiring em index.ts e exposição via preload** — `src/main/auth/ipc-handlers.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts` written, not committed.

## Files Created/Modified
- `src/main/auth/deep-link-handler.ts` - protocol registration + argv/URL parsing (pure functions)
- `src/main/auth/ipc-handlers.ts` - IPC channel handlers, thin wrapper over `./auth`
- `src/main/index.ts` - `registerProtocol()` call, extended `second-instance` handler, `setupAuthIpcHandlers` + session-restore wiring inside `whenReady`
- `src/preload/index.d.ts` - `AuthApi` interface, `window.auth` global declaration

## Decisions Made
- See `key-decisions` in frontmatter above. No architectural deviations — the plan's exact code shapes were used, adapted only for the actual current content of `index.ts`/`preload` (which already had F0/F3 additions the plan told this agent to read first and integrate over, not overwrite).

## Deviations from Plan

None — plan executed exactly as written. All four files match the plan's specified shapes (function names, IPC channel names, `window.auth` surface) exactly.

## Issues Encountered
None. `Read` tool required re-reading `src/main/index.ts` with its own tool before `Edit` would accept a diff against it (a prior `cat -n` via Bash didn't register as a "read" for the Edit tool's tracking) — resolved by reading it again through `Read`, no functional impact.

## User Setup Required
None from this plan directly. As noted in 02-02's summary, `MAIN_VITE_WORKOS_CLIENT_ID` must exist in `.env.local` for `getSignInUrl` to produce a real URL at runtime — unchanged by this plan.

## What I verified vs. what I only wrote

**Verified by running:**
- `npm run typecheck` (node + web) — passes clean, no errors.
- `npm run build` — full electron-vite build (main, preload, renderer) succeeds; `out/main/index.js`, `out/preload/index.js`, `out/renderer/*` all produced.
- `grep` checks confirming no regression: `requestSingleInstanceLock`, `contextIsolation: true`, `nodeIntegration: false`, `minWidth: 900`, `minHeight: 600`, and the `second-instance` listener are all still present in `src/main/index.ts` after the edit.
- `grep` confirming the preload never exposes `ipcRenderer` on `window` — only `contextBridge.exposeInMainWorld` calls, and `authApi` wraps only `.invoke`/`.on`/`.removeListener` calls scoped to the four named channels.
- `grep` confirming no `apiKey`/`WORKOS_API_KEY`/`sk_` literal appears anywhere in the files touched by this plan.
- `window.auth` type surface in `index.d.ts` matches exactly `signIn`, `signOut`, `getUser`, `getAccessToken`, `onAuthChange` — no extra/missing members.

**NOT verified (cannot be, from this Linux sandbox — this is the critical gap the plan itself calls out):**
- `app.setAsDefaultProtocolClient('janja', ...)` was never actually invoked against a real Windows registry — this environment is Linux and has no Electron app instance running (no display, no `npm run dev` executed against a real window). The dev-vs-packaged branching logic in `registerProtocol()` is verified by code-reading against 02-RESEARCH.md §6 (Electron's own docs, quoted verbatim there), not by execution.
- No real `janja://callback?code=...&state=...` URL was ever delivered through an actual OS-level second-instance launch. The `second-instance` handler's new callback-extraction code was verified only by type-checking and reading — never exercised with a real `argv` array containing a `janja://` URL.
- `did-finish-load` firing before/after a real login round-trip, and the renderer actually receiving `auth:on-auth-change`, were not exercised (no renderer code consuming `window.auth` exists yet — that's 02-07's job).

**What the user will need to test, and how, once this reaches Windows:**
1. Run `npm run dev` on Windows with a real `MAIN_VITE_WORKOS_CLIENT_ID` in `.env.local` and a WorkOS AuthKit app configured with `janja://callback` as an allowed redirect URI.
2. From the renderer (once 02-07 wires a UI to it), call `window.auth.signIn()` — confirm the *system default browser* opens (not an in-app window) to a WorkOS AuthKit login page.
3. Complete login in the browser. Confirm Windows prompts "Open Janja?" (or opens silently, depending on registry state) and that the running `npm run dev` Electron process — not a new window — receives focus, proving the single-instance lock intercepted the second launch.
4. Check the dev console output for either `[auth] Failed to handle OAuth callback: ...` (something went wrong — investigate the logged error) or silence + a subsequent `auth:on-auth-change` IPC message reaching the renderer (success).
5. Quit and relaunch the app (not a second instance — a full quit and restart) to verify the session-restore path: `getUser()` should return the previously authenticated user without a new login prompt, and `window.auth.onAuthChange` should fire once shortly after the window loads.
6. Test protocol registration in *packaged* mode too (`npm run build:win`) at some point before Fase 9 ships — the dev-mode `process.execPath` + script-path branch and the packaged no-args branch are genuinely different code paths and only one of them (dev) will even be exercised by step 1-5 above.

## Next Phase Readiness
- `window.auth` is fully typed and available for 02-07 (renderer `useAuth` hook + `ConvexProviderWithAuth`) to consume directly — `fetchAccessToken` can call `window.auth.getAccessToken({ forceRefreshToken })` with no further main-process changes needed.
- The full SO → app → renderer path described in this plan's `<success_criteria>` is code-complete and type-checks/builds clean, but is **entirely unverified at runtime** — this can only happen on Windows, as this plan's task explicitly anticipated. No blocker for continuing other Fase 2 work in parallel (convex/ plans 02-05/02-06 are untouched by this plan, per file ownership).
- `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts` are left uncommitted per `NO_GIT`; the orchestrator will commit these in series with sibling agents' work.

---
*Phase: 02-convex-auth-workos*
*Completed: 2026-08-18*
