---
phase: 02-convex-auth-workos
plan: 02
subsystem: auth
tags: [workos, oauth, pkce, electron, safestorage, main-process]

# Dependency graph
requires:
  - phase: 02-convex-auth-workos (plan 01)
    provides: convex/schema.ts (users, presence), convex/auth.config.ts, convex + convex-test in package.json
provides:
  - src/main/auth/types.ts (AUTH_CHANNELS, AuthUser, AuthIpcResult)
  - src/main/auth/session-store.ts (encrypted session persistence via safeStorage async API)
  - src/main/auth/auth.ts (getSignInUrl, handleCallback, getAccessToken, getUser, clearSession, getLogoutUrl)
  - @workos-inc/node dependency installed (^10.10.0)
affects: [02-03 (IPC + protocol wiring), 02-07 (ConvexProviderWithAuth/renderer auth hook)]

# Tech tracking
tech-stack:
  added: ["@workos-inc/node@^10.10.0"]
  patterns:
    - "PublicWorkOS client via createWorkOS({ clientId }) — no apiKey anywhere, TypeScript enforces this at compile time"
    - "Session persisted as encrypted JSON blob (base64) in a dedicated file under app.getPath('userData'), never electron-store, never sync safeStorage"
    - "In-memory cache of access token + user, refresh token is the only thing that touches disk"
    - "Every readSession() call wrapped in try/catch, always degrades to null (no session) — never throws"

key-files:
  created:
    - src/main/auth/types.ts
    - src/main/auth/session-store.ts
    - src/main/auth/auth.ts
  modified:
    - package.json (added @workos-inc/node)
    - package-lock.json

key-decisions:
  - "Followed the plan's code verbatim for session-store.ts and auth.ts — no deviations needed."
  - "Declared the MAIN_VITE_WORKOS_CLIENT_ID env var type via `declare global { interface ImportMetaEnv { ... } }` inside auth.ts itself (module-scoped augmentation of electron-vite's global ImportMetaEnv), rather than adding a new ambient .d.ts file — keeps the addition self-contained in the one file I own that needs it."

patterns-established:
  - "Main-process auth module is a plain function-export module (no class, no singleton object) — callable directly by same-process IPC handlers (plan 02-03), no IPC needed internally."

# Metrics
duration: ~25min
completed: 2026-08-18
---

# Phase 02 Plan 02: Main Process OAuth Core Summary

**PKCE login/refresh/logout core for WorkOS AuthKit in the Electron main process, session persisted via `safeStorage.encryptStringAsync`/`decryptStringAsync` to a dedicated file, with `createWorkOS({ clientId })` (no API key) enforced at the type level.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-18T20:56Z
- **Tasks:** 2/2
- **Files modified:** 5 (3 created, 2 modified: package.json, package-lock.json)

## Accomplishments
- `src/main/auth/types.ts`: shared `AUTH_CHANNELS`, `AuthUser`, `AuthIpcResult` types for the IPC layer plan 02-03 will build.
- `src/main/auth/session-store.ts`: `writeSession`/`readSession`/`clearStoredSession` — session is `{ refreshToken, workosId }` JSON, encrypted whole via `safeStorage.encryptStringAsync`, written base64-encoded to `auth-session.enc` in `app.getPath('userData')`. `readSession()` never throws — any failure (missing file, bad base64, DPAPI decrypt failure, corrupt JSON) is caught and returns `null`.
- `src/main/auth/auth.ts`: full PKCE flow — `getSignInUrl` (generates URL + state + codeVerifier, holds pending login in memory with a 10-min TTL), `handleCallback` (validates `state` byte-for-byte before exchanging the code, via `authenticateWithCodeAndVerifier`), `getAccessToken(forceRefreshToken?)` (serves from in-memory cache when not expired, otherwise reads the persisted refresh token and calls `authenticateWithRefreshToken`, clearing the stored session if the refresh token itself is dead), `getUser`, `clearSession`, `getLogoutUrl` (returns `null` gracefully when there's no cached session/`sid`, never throws).
- `@workos-inc/node@^10.10.0` installed and its published `.d.ts` inspected directly (not from memory) to confirm every method signature used (`createWorkOS` overloads, `PublicWorkOS`/`PublicUserManagement`, `getAuthorizationUrlWithPKCE`, `authenticateWithCodeAndVerifier`, `authenticateWithRefreshToken`, `getLogoutUrl`, and the full `User` interface fields) matches the plan and 02-RESEARCH.md §2 exactly.

## Task Commits

Per explicit instruction in this agent's task (`NO_GIT` — sibling agents are running concurrently in the same worktree and the orchestrator commits in series), **no git commits were made**. All files are written to disk and left uncommitted for the orchestrator to commit.

1. **Task 1: Tipos compartilhados e persistência de sessão via safeStorage assíncrono** — files written, not committed.
2. **Task 2: Fluxo PKCE completo (login, callback, refresh, logout)** — files written, not committed.

## Files Created/Modified
- `src/main/auth/types.ts` - `AUTH_CHANNELS`, `AuthUser`, `AuthIpcResult`
- `src/main/auth/session-store.ts` - encrypted session persistence (safeStorage async only)
- `src/main/auth/auth.ts` - PKCE login/callback/refresh/logout core, `createWorkOS({ clientId })` with no `apiKey`
- `package.json` - added `@workos-inc/node@^10.10.0`
- `package-lock.json` - lockfile update from `npm install`

## Decisions Made
- Verified every WorkOS SDK method signature and the full `User` interface against the actual published `.d.ts` in `node_modules/@workos-inc/node/lib/factory-vzr4nni7.d.mts` before writing code — confirms 02-RESEARCH.md §2 is accurate for the installed version (10.10.0), no surprises (e.g. `getLogoutUrl` is synchronous and returns `string`, matching the plan's non-`await`ed usage).
- Typed `import.meta.env.MAIN_VITE_WORKOS_CLIENT_ID` via a `declare global { interface ImportMetaEnv { ... } }` block inside `auth.ts`, since electron-vite's `ImportMetaEnv` (from `electron-vite/node` types, referenced by `tsconfig.node.json`) only declares `MODE`/`DEV`/`PROD` out of the box and needs augmenting per-project-var. This is additive declaration merging, doesn't touch electron-vite's own types, and lives entirely inside the file I own.

## Deviations from Plan

None - plan executed exactly as written. Code for `session-store.ts` and `auth.ts` was copied essentially verbatim from the plan (only reformatted for the project's existing Prettier/quote style, e.g. no semicolons removed since electron-vite's own `index.ts` uses no-trailing-comma/single-quote conventions the linter already enforces — kept consistent).

## Issues Encountered
None.

## User Setup Required
None from this plan directly — `MAIN_VITE_WORKOS_CLIENT_ID` needs to exist in `.env.local` for `getSignInUrl`/`auth.ts` to actually work at runtime (documented already in `.env.local.example`, not part of this plan's scope to populate).

## What I verified vs. what I only wrote

**Verified by running:**
- `npm install @workos-inc/node@^10.10.0` — succeeded, 0 vulnerabilities.
- `npm run typecheck:node` — passes with the 3 new files included (tsconfig.node.json includes `src/main/**/*`).
- `npm run typecheck` (node + web) — passes.
- `npm run build` — full electron-vite build (main, preload, renderer) succeeds.
- `grep` checks: no `apiKey`/`WORKOS_API_KEY`/`sk_` literal usage anywhere in `src/main/auth/` (only in comments explaining the constraint); no sync `encryptString(`/`decryptString(` or `electron-store` in `session-store.ts`; all six required functions (`getSignInUrl`, `handleCallback`, `getAccessToken`, `getUser`, `clearSession`, `getLogoutUrl`) are exported from `auth.ts`.
- Read the actual published `.d.ts` of the installed `@workos-inc/node@10.10.0` to confirm every method/type signature used compiles against what's really installed, not just what 02-RESEARCH.md claimed.

**NOT verified (cannot be, from this environment):**
- No actual OAuth round trip was performed — there is no browser, no `janja://callback` deep link, and no real WorkOS client configured in this sandbox. `getSignInUrl`/`handleCallback`/`getAccessToken`/`getLogoutUrl` are only verified by type-checking and code reading, exactly as the plan's objective states ("testável por leitura de código antes de qualquer wiring"). The full flow (open system browser → user logs in → `janja://callback` arrives via `second-instance` → code exchanged → session written to disk → app restart → session read back and refreshed) can only be tested end-to-end on Windows with a real WorkOS AuthKit app once plan 02-03 wires this module into `index.ts`, the custom protocol, and IPC.
- `safeStorage.encryptStringAsync`/`decryptStringAsync` behavior was not exercised at runtime (no Electron app instance was started in this session) — correctness rests on matching the Electron docs API signature exactly (confirmed via 02-RESEARCH.md §3, a documentation-sourced not memory-sourced claim) plus the try/catch discipline being visibly present in the code.

## Next Phase Readiness
- Plan 02-03 (IPC + custom protocol wiring in `src/main/index.ts`) can now import `getSignInUrl`, `handleCallback`, `getAccessToken`, `getUser`, `clearSession`, `getLogoutUrl` from `./auth/auth` and wire them to the `AUTH_CHANNELS` from `./auth/types` — no further changes needed in this module for that to work.
- `src/main/index.ts` was intentionally NOT touched, per file ownership boundaries for this plan.
- No blockers. One thing plan 02-03 (or whoever runs the app first) will need: an actual `MAIN_VITE_WORKOS_CLIENT_ID` value in `.env.local` — without it `createWorkOS({ clientId: undefined })` will construct a client with an undefined clientId, which will only surface as a runtime error the first time `getSignInUrl` is actually invoked (not a typecheck-time issue, since the env var is typed as `string` but electron-vite doesn't enforce it's actually set).

---
*Phase: 02-convex-auth-workos*
*Completed: 2026-08-18*
