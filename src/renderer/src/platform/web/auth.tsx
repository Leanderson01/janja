import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { AuthKitProvider, useAuth as useAuthKit } from '@workos-inc/authkit-react'
import type { PlatformAuth, SessionUser } from '@/platform/contract'

/**
 * O lado WEB da costura de autenticação: o mesmo access token da WorkOS, o
 * mesmo emissor, o mesmo JWKS — só que emitido para o NAVEGADOR em vez de para
 * o processo main. `convex/auth.config.ts` não muda uma linha, e é por isso que
 * o desktop instalado nas dez máquinas continua sendo aceito pelo mesmo backend
 * enquanto a web sobe ao lado dele.
 *
 * ── NÃO INSTALAR `@convex-dev/workos`. ────────────────────────────────────
 * Ele é a coisa "óbvia" que a próxima pessoa vai querer adicionar aqui, e a
 * pesquisa da Fase 10 leu o `dist` publicado (0.0.3) inteiro: são 30 linhas,
 * ele nem importa `authkit-react` em runtime, e é literalmente o
 * `useConvexAuthAdapter` que este repo já tinha desde a Fase 2 — com um
 * defeito a mais. Ele chama `getAccessToken()` SEM ARGUMENTO, jogando fora o
 * `forceRefreshToken` que o `ConvexProviderWithAuth` passa quando o backend
 * recusa o token. Isso é exatamente a alavanca que o `AuthWatchdog` existe
 * para puxar (Pitfall 4, `get-convex/convex-backend#259`, TTL de 8h). Uma
 * dependência a mais para ficar pior. `platform/web/auth.test.ts` existe para
 * impedir a regressão a esse comportamento.
 * ──────────────────────────────────────────────────────────────────────────
 */

/**
 * `Boolean(VITE_WORKOS_CLIENT_ID)` — e o módulo NUNCA lança no topo, mesmo com
 * a variável ausente.
 *
 * Um `throw` em nível de módulo acontece antes de existir qualquer error
 * boundary: a página fica branca e o console mostra uma stack de node_modules.
 * O projeto já pagou por isso uma vez (`isConvexConfigured`, corrigido no Plano
 * 09-02) e a saída é a mesma aqui — `main.tsx` lê esta constante e mostra a
 * tela de "Configuração incompleta" legível.
 *
 * O espelho no lado Electron é `true` fixo: lá o client id é do processo main.
 */
export const isAuthConfigured = Boolean(import.meta.env.VITE_WORKOS_CLIENT_ID)

type AuthKitContext = ReturnType<typeof useAuthKit>

/**
 * O contrato pede `signIn`/`signOut`/`getProfile`/`hasLiveSession` como funções
 * comuns, não hooks — porque quem as chama são handlers de evento e o
 * `AuthWatchdog` de dentro de um `setTimeout`. No Electron isso é trivial (o
 * estado mora no processo main). Na web, o estado mora num contexto do React, e
 * a única forma honesta de alcançá-lo de fora de um componente é uma trava:
 * um componente invisível dentro do provider publica o valor do contexto aqui.
 *
 * Consequência aceita e documentada: antes de o provider montar, a trava é
 * `null`, e as funções que dependem dela dizem isso em voz alta (`signIn` lança
 * uma mensagem legível; `getProfile`/`hasLiveSession` respondem "não sei",
 * que é `null`/`false` — nunca exceção, como o contrato exige).
 */
let authKit: AuthKitContext | null = null

function AuthKitLatch(): null {
  const ctx = useAuthKit()
  // Em efeito, não durante o render: publicar no escopo do módulo enquanto o
  // React renderiza é impuro (e o `react-hooks/purity` reclama). O efeito da
  // trava roda antes dos efeitos dos filhos irmãos posteriores, e muito antes
  // de qualquer clique ou do timer de 15s do watchdog.
  useEffect(() => {
    authKit = ctx
    return () => {
      if (authKit === ctx) authKit = null
    }
  }, [ctx])
  return null
}

/**
 * O provider da web. Cada prop abaixo é uma decisão, e cada decisão tem o
 * comentário que a sustenta.
 */
function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <AuthKitProvider
      // `?? ''` só existe para o módulo nunca lançar: quem garante que a
      // variável está preenchida é `main.tsx`, através de `isAuthConfigured`.
      clientId={import.meta.env.VITE_WORKOS_CLIENT_ID ?? ''}
      // ── devMode é decisão de CUSTO, não de engenharia, e está TRAVADA. ──
      // Fora de `devMode`, o `authkit-js` guarda o refresh token só em memória
      // (`utils/session-data.ts`) e depende de um cookie HttpOnly do domínio da
      // WorkOS; para esse cookie sobreviver ao bloqueio de cookies de terceiros,
      // a WorkOS exige um custom auth domain, listado no preço deles como
      // "Custom domain — US$ 99/mo". Para dez amigos, está fora. A própria doc
      // client-only da WorkOS manda usar `devMode` nesse caso.
      //
      // O QUE SE PERDE, COM TODAS AS LETRAS: o refresh token fica em
      // `localStorage`, legível por JavaScript da própria origem. O risco
      // concreto é XSS. A MITIGAÇÃO É REQUISITO VERIFICÁVEL, NÃO BOA INTENÇÃO:
      // zero `dangerouslySetInnerHTML` e zero ESCRITA de `innerHTML` no
      // renderer (hoje: zero e zero — as ocorrências de `innerHTML` no repo são
      // LEITURAS em asserções de `LinkPreviewCard.test.tsx`), CSP restritiva
      // mantida em `src/renderer/index.html`, e nenhum script de terceiro.
      // Essa contagem passa a ser invariante do projeto: quem a quebrar está
      // entregando o refresh token de todo mundo junto.
      devMode={true}
      // `redirectUri` OMITIDO DE PROPÓSITO: o default do `authkit-js` é
      // `window.origin` (`create-client.ts`), e a doc client-only da WorkOS
      // manda apontar o callback para a mesma rota onde a autenticação é
      // exigida. Não existe rota `/callback` a criar e não entra router nenhum
      // neste projeto — o `initialize()` detecta `?code=&state=` na própria URL
      // e limpa com `history.replaceState`.
      //
      // Refresh falhou de vez: tentar entrar de novo. Se a sessão da WorkOS
      // ainda existir, o redirect é silencioso; se não, cai na tela de login.
      // É a saída da web para o mesmo problema que no desktop vira
      // `window.location.reload()` — e é a PRIMEIRA linha de defesa do
      // Pitfall 4 na web (o `AuthWatchdog` é a segunda).
      onRefreshFailure={({ signIn: retrySignIn }) => {
        console.warn('[platform/web] refresh do AuthKit falhou — tentando entrar de novo.')
        void retrySignIn()
      }}
    >
      <AuthKitLatch />
      {children}
    </AuthKitProvider>
  )
}

/**
 * O `User` do `authkit-js` (`interfaces/user.interface.ts`) já traz `email`,
 * `firstName`, `lastName` e `profilePictureUrl` — exatamente os quatro campos
 * de `SessionUser` e do `AuthUserLike` de `lib/profile-hint.ts`. É por essa
 * coincidência MEDIDA (conferida no `.d.ts` do pacote instalado) que
 * `profile-hint.ts` não muda uma linha nesta fase.
 */
function toSessionUser(user: AuthKitContext['user']): SessionUser | null {
  if (!user) return null
  return {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    profilePictureUrl: user.profilePictureUrl
  }
}

function useSession(): { user: SessionUser | null; loading: boolean; error: string | null } {
  const { isLoading, user } = useAuthKit()
  // `error` é sempre `null` aqui, e isso não é preguiça: no desktop o campo
  // carrega a falha de COMUNICAÇÃO com o processo main (o IPC lançando por app
  // mal configurado). Na web não há esse canal — configuração ausente vira a
  // tela de `main.tsx`, e falha de refresh vira `onRefreshFailure`. Inventar
  // uma string aqui só produziria erro que ninguém sabe interpretar.
  return useMemo(
    () => ({ user: toSessionUser(user), loading: isLoading, error: null }),
    [user, isLoading]
  )
}

/**
 * O adaptador que `ConvexProviderWithAuth` recebe. É o MESMO `useMemo` sobre o
 * mesmo trio do lado Electron, lendo de outro lugar.
 *
 * A LINHA QUE NÃO PODE SER SIMPLIFICADA é a de dentro do `try`: o
 * `forceRefreshToken` que o Convex passa vira o `forceRefresh` que o
 * `authkit-js` aceita. Tirar o argumento (que é o que o `@convex-dev/workos`
 * faz) compila, passa em typecheck e só aparece como "o app travou em
 * desautenticado depois de horas". `auth.test.ts` prova as duas direções.
 *
 * O `catch` é a outra metade: `LoginRequiredError`/`RefreshError` viram "sem
 * token", nunca uma exceção que sobe para dentro do cliente do Convex.
 */
function useConvexAuthAdapter(): {
  isLoading: boolean
  isAuthenticated: boolean
  fetchAccessToken: (args: { forceRefreshToken: boolean }) => Promise<string | null>
} {
  const { isLoading, user, getAccessToken } = useAuthKit()

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }): Promise<string | null> => {
      try {
        return await getAccessToken({ forceRefresh: forceRefreshToken })
      } catch {
        return null
      }
    },
    [getAccessToken]
  )

  return useMemo(
    () => ({
      isLoading,
      isAuthenticated: !!user,
      fetchAccessToken
    }),
    [isLoading, user, fetchAccessToken]
  )
}

function requireAuthKit(): AuthKitContext {
  if (!authKit) {
    throw new Error(
      'A sessão do AuthKit ainda não está montada. Recarregue a página e tente de novo.'
    )
  }
  return authKit
}

/** Navegação de topo para a página hospedada da WorkOS (não abre outra aba). */
async function signIn(): Promise<void> {
  await requireAuthKit().signIn()
}

/**
 * `signOut()` do `authkit-js` navega para a URL de logout da WorkOS — que
 * precisa da Sign-out URI cadastrada no dashboard, senão a doc é explícita que
 * dá erro. A sobrecarga usada aqui é a que devolve `void` (navega); o `await`
 * existe só para respeitar o contrato `Promise<void>`.
 */
async function signOut(): Promise<void> {
  await requireAuthKit().signOut()
}

/** Nunca lança (contrato): sem provider montado, "não deu para saber" é `null`. */
async function getProfile(): Promise<SessionUser | null> {
  return authKit ? toSessionUser(authKit.user) : null
}

/**
 * A pergunta do watchdog, feita ao AuthKit em vez de a um processo main: se o
 * contexto ainda tem `user`, a sessão do navegador está viva e o
 * `isAuthenticated: false` do Convex é o Pitfall 4, não um logout de verdade.
 */
async function hasLiveSession(): Promise<boolean> {
  return authKit?.user != null
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
