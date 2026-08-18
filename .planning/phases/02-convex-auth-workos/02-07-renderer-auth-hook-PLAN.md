---
phase: 02-convex-auth-workos
plan: 07
type: execute
wave: 4
depends_on: ["02-03", "02-04"]
files_modified:
  - src/renderer/src/hooks/useAuth.ts
  - src/renderer/src/lib/convex-client.ts
  - src/renderer/src/hooks/useConvexAuthAdapter.ts
autonomous: true

must_haves:
  truths:
    - "O renderer tem um hook React que reflete o estado de login vindo do processo main (usuário, carregando, entrar, saudar)"
    - "Existe uma ponte que traduz esse hook para o contrato exato que ConvexProviderWithAuth espera (isLoading, isAuthenticated, fetchAccessToken)"
  artifacts:
    - path: "src/renderer/src/hooks/useAuth.ts"
      provides: "Hook React consumindo window.auth (IPC) — user, loading, signIn, signOut"
    - path: "src/renderer/src/hooks/useConvexAuthAdapter.ts"
      provides: "Hook no formato exigido por ConvexProviderWithAuth, chamando window.auth.getAccessToken"
      contains: "fetchAccessToken"
    - path: "src/renderer/src/lib/convex-client.ts"
      provides: "Instância única de ConvexReactClient usando VITE_CONVEX_URL"
  key_links:
    - from: "src/renderer/src/hooks/useConvexAuthAdapter.ts"
      to: "window.auth.getAccessToken"
      via: "fetchAccessToken({ forceRefreshToken })"
      pattern: "getAccessToken"
---

<objective>
Trazer o estado de autenticação do IPC para dentro do React, e traduzir esse estado para o
formato exato que o `ConvexProviderWithAuth` do Convex exige — o "escape hatch" de ~50 linhas
que o design doc já previa, porque `@convex-dev/workos` não serve aqui (depende de
`authkit-react` rodando no browser, e o token do janja vem do processo main via IPC).

Purpose: sem isso, o Convex não tem como saber quem está autenticado — toda query/mutation
autenticada (`ensureUser`, `heartbeat`, e todo o resto que F4-F7 vão construir em cima) fica
inacessível.
Output: `useAuth`, `useConvexAuthAdapter`, `convex-client.ts` — ainda sem nenhuma UI ou
wiring no `main.tsx` (isso é o próximo plano, 02-08).
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/02-convex-auth-workos/02-RESEARCH.md
@src/preload/index.d.ts

# 02-RESEARCH.md §4: o contrato exigido por ConvexProviderWithAuth (lido diretamente do
# código-fonte publicado de @convex-dev/workos, não de memória) é exatamente
# { isLoading, isAuthenticated, fetchAccessToken }, onde fetchAccessToken recebe
# { forceRefreshToken: boolean } e devolve Promise<string | null>.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Hook useAuth sobre window.auth</name>
  <files>src/renderer/src/hooks/useAuth.ts</files>
  <action>
    Criar `src/renderer/src/hooks/useAuth.ts`:
    ```ts
    import { useState, useEffect, useCallback } from 'react'
    import type { AuthUser } from '../../../main/auth/types'

    interface UseAuthReturn {
      user: AuthUser | null
      loading: boolean
      signIn: () => Promise<{ success: boolean; error?: string }>
      signOut: () => Promise<{ success: boolean; error?: string }>
    }

    export function useAuth(): UseAuthReturn {
      const [user, setUser] = useState<AuthUser | null>(null)
      const [loading, setLoading] = useState(true)

      useEffect(() => {
        window.auth.getUser().then((u) => {
          setUser(u)
          setLoading(false)
        })
        return window.auth.onAuthChange(({ user: u }) => {
          setUser(u)
          setLoading(false)
        })
      }, [])

      const signIn = useCallback(() => window.auth.signIn(), [])
      const signOut = useCallback(() => window.auth.signOut(), [])

      return { user, loading, signIn, signOut }
    }
    ```
    Se o import de tipo `AuthUser` a partir de `../../../main/auth/types` não resolver
    limpo pelos `tsconfig` de renderer (processos diferentes, configs de TS separadas),
    duplicar a interface localmente em `useAuth.ts` (mesmo formato de campos) em vez de
    lutar contra o isolamento de tipos entre processos — é o mesmo compromisso que o exemplo
    oficial da WorkOS faz (a `useAuth.ts` dele redefine `User` localmente em vez de importar
    do main).
  </action>
  <verify>`npm run typecheck:web` passa; `useAuth` expõe exatamente `user`, `loading`, `signIn`, `signOut`.</verify>
  <done>Hook funcional, consumível por qualquer componente do renderer sem acoplamento direto ao IPC.</done>
</task>

<task type="auto">
  <name>Task 2: Cliente Convex e adaptador para ConvexProviderWithAuth</name>
  <files>src/renderer/src/lib/convex-client.ts, src/renderer/src/hooks/useConvexAuthAdapter.ts</files>
  <action>
    Criar `src/renderer/src/lib/convex-client.ts`:
    ```ts
    import { ConvexReactClient } from 'convex/react'

    const url = import.meta.env.VITE_CONVEX_URL
    if (!url) {
      throw new Error('VITE_CONVEX_URL não definida — ver .env.local.example e o checkpoint 02-04')
    }

    export const convexClient = new ConvexReactClient(url)
    ```

    Criar `src/renderer/src/hooks/useConvexAuthAdapter.ts`:
    ```ts
    import { useCallback, useMemo } from 'react'
    import { useAuth } from './useAuth'

    /** Formato exigido por ConvexProviderWithAuth (convex/react) — ver 02-RESEARCH.md §4. */
    export function useConvexAuthAdapter() {
      const { user, loading } = useAuth()

      const fetchAccessToken = useCallback(
        async ({ forceRefreshToken }: { forceRefreshToken: boolean }): Promise<string | null> => {
          try {
            return await window.auth.getAccessToken({ forceRefreshToken })
          } catch {
            return null
          }
        },
        [],
      )

      return useMemo(
        () => ({
          isLoading: loading,
          isAuthenticated: !!user,
          fetchAccessToken,
        }),
        [loading, user, fetchAccessToken],
      )
    }
    ```
    Este hook não é usado diretamente por componentes de UI — é passado como prop `useAuth`
    para `ConvexProviderWithAuth` no plano 02-08 (`<ConvexProviderWithAuth client={convexClient}
    useAuth={useConvexAuthAdapter}>`).
  </action>
  <verify>`npm run typecheck:web` passa; `useConvexAuthAdapter` retorna exatamente `{ isLoading, isAuthenticated, fetchAccessToken }`; `convex-client.ts` lança erro claro (não silencioso) se `VITE_CONVEX_URL` estiver ausente.</verify>
  <done>Convex client instanciado e adaptador de auth pronto para ser plugado no ConvexProviderWithAuth.</done>
</task>

</tasks>

<verification>
- `npm run typecheck:web` passa.
- `useConvexAuthAdapter` nunca lança para fora de `fetchAccessToken` — sempre `string | null`.
- `convex-client.ts` falha alto e imediatamente (erro claro no boot) se a env var estiver ausente, em vez de deixar o Convex tentar conectar em `undefined`.
</verification>

<success_criteria>
Toda a ponte de autenticação do lado do renderer existe e compila, pronta para ser wireada
no `main.tsx` no próximo plano — sem tocar ainda em nenhum componente visual.
</success_criteria>

<output>
After completion, create `.planning/phases/02-convex-auth-workos/02-07-SUMMARY.md`.
</output>
