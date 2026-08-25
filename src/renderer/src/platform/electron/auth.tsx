import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PlatformAuth, SessionUser } from '@/platform/contract'

/**
 * O lado ELECTRON da costura de autenticação: o caminho que já existe desde a
 * Fase 2, movido para trás do contrato — e SÓ movido.
 *
 * Nada aqui é novo. `useSession` e `useConvexAuthAdapter` são o corpo de
 * `hooks/useAuth.ts` e `hooks/useConvexAuthAdapter.ts` como estavam, na mesma
 * ordem de chamadas, com os mesmos `.catch`/`.finally`. Esse é o requisito:
 * quem usa o app instalado hoje é o grupo inteiro, e o compilador não reclama
 * se a ordem de duas chamadas mudar ou se uma guarda sumir.
 *
 * O PERFIL É DUPLICADO DE PROPÓSITO (o comentário que morava em
 * `hooks/useAuth.ts`): o formato devolvido pelo preload espelha o `AuthUser` de
 * `src/main/auth/types.ts`, mas `src/main` não está no `include` do
 * `tsconfig.web.json` — processo separado, config de TS separada —, então
 * importar através dessa fronteira não resolve limpo. O exemplo oficial da
 * WorkOS para Electron faz a mesma escolha. A diferença agora é que a
 * duplicação deixou de ser um contorno local e virou o formato canônico dos
 * dois alvos: `SessionUser` em `platform/contract.ts`, igual ao `User` do
 * `authkit-js` e ao `AuthUserLike` de `lib/profile-hint.ts`. Se o formato
 * mudar em `src/main/auth/types.ts`, é aqui e no contrato que ele acompanha.
 */

/**
 * O Electron NÃO TEM provider de autenticação, e isto não é esquecimento: quem
 * guarda a sessão (PKCE, refresh, `safeStorage`) é o processo main, e o
 * renderer só conversa com ele por IPC. O componente existe para que
 * `main.tsx` possa montar `auth.AuthProvider` incondicionalmente, sem um
 * `if (isElectron)` — no alvo web ele é o `<AuthKitProvider devMode>`.
 * Sendo transparente, a árvore de providers do desktop fica IDÊNTICA à de
 * antes desta fase.
 */
function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return <>{children}</>
}

function useSession(): { user: SessionUser | null; loading: boolean; error: string | null } {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // `.catch` + `.finally` não são zelo excessivo: sem eles, qualquer rejeição
    // desta promise deixa `loading` em true para sempre, e o app fica numa tela
    // "Carregando…" eterna, sem erro visível e sem caminho de saída. Foi
    // exatamente o que aconteceu quando o clientId do WorkOS não estava
    // configurado — o handler de IPC lançava, a promise rejeitava, e o app
    // travava em silêncio.
    //
    // Falhar aqui significa "não há sessão utilizável": tratamos como deslogado,
    // guardamos a causa para a interface poder mostrá-la, e liberamos o loading.
    window.auth
      .getUser()
      .then((u) => setUser(u))
      .catch((err: unknown) => {
        console.error('Falha ao consultar a sessão:', err)
        setUser(null)
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setLoading(false))

    return window.auth.onAuthChange(({ user: u }) => {
      setUser(u)
      setError(null)
      setLoading(false)
    })
  }, [])

  return { user, loading, error }
}

/**
 * Formato exigido por `ConvexProviderWithAuth` (convex/react) — ver
 * 02-RESEARCH.md §4 e o comentário de `PlatformAuth` no contrato. Verificado
 * contra os tipos publicados do pacote `convex` instalado
 * (`node_modules/convex/dist/esm-types/react/ConvexAuthState.d.ts`).
 *
 * `forceRefreshToken` atravessa até o processo main sem ser descartado: é a
 * alavanca do Pitfall 4 (`get-convex/convex-backend#259`) que o `AuthWatchdog`
 * existe para puxar.
 */
function useConvexAuthAdapter(): {
  isLoading: boolean
  isAuthenticated: boolean
  fetchAccessToken: (args: { forceRefreshToken: boolean }) => Promise<string | null>
} {
  const { user, loading } = useSession()

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }): Promise<string | null> => {
      try {
        return await window.auth.getAccessToken({ forceRefreshToken })
      } catch {
        return null
      }
    },
    []
  )

  return useMemo(
    () => ({
      isLoading: loading,
      isAuthenticated: !!user,
      fetchAccessToken
    }),
    [loading, user, fetchAccessToken]
  )
}

/**
 * O IPC devolve `{ success, error }`; o contrato é `Promise<void>`, porque na
 * web quem "falha" é uma navegação que nem sempre volta. A tradução é lançar —
 * e a `LoginScreen` continua exibindo exatamente a mesma string de erro que
 * exibia antes, agora vinda do `catch` em vez do `result.error`.
 */
async function signIn(): Promise<void> {
  const result = await window.auth.signIn()
  if (!result.success) throw new Error(result.error ?? 'Falha ao entrar. Tente novamente.')
}

async function signOut(): Promise<void> {
  const result = await window.auth.signOut()
  if (!result.success) throw new Error(result.error ?? 'Falha ao sair. Tente novamente.')
}

/** Nunca lança: "não deu para saber" é `null`, não exceção (ver contrato). */
function getProfile(): Promise<SessionUser | null> {
  return window.auth.getUser().catch((err: unknown) => {
    console.error('[platform/electron] falha ao ler o perfil do WorkOS:', err)
    return null
  })
}

/**
 * A pergunta do watchdog. No desktop ela é feita ao processo main, que é quem
 * sabe se a sessão cifrada em disco ainda vale.
 */
function hasLiveSession(): Promise<boolean> {
  return window.auth
    .getUser()
    .then(Boolean)
    .catch(() => false)
}

export const auth: PlatformAuth = {
  AuthProvider,
  useSession,
  useConvexAuthAdapter,
  signIn,
  signOut,
  getProfile,
  hasLiveSession
}

/**
 * Espelho de `isAuthConfigured` do lado web, e SEMPRE `true` aqui de propósito:
 * no Electron o client id vive em `MAIN_VITE_WORKOS_CLIENT_ID`, lido pelo
 * PROCESSO MAIN — o renderer nunca o vê e portanto não tem como julgá-lo. App
 * mal configurado no desktop já aparece por outro caminho, o `error` de
 * `useSession` (o handler de IPC lança `AuthNotConfiguredError`), que a
 * `LoginScreen` mostra. Existir nos dois lados é o que permite `main.tsx`
 * decidir sem um `if (isElectron)`.
 */
// Anotado como `boolean` (e não deixado no literal `true`) para os dois alvos
// terem o MESMO tipo: com o literal, `if (!isAuthConfigured)` em `main.tsx`
// viraria um ramo provadamente morto no typecheck do desktop, e o próximo
// leitor concluiria que a tela de configuração incompleta não é necessária.
export const isAuthConfigured: boolean = true
