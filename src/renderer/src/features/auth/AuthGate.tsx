import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useConvexAuth, useMutation } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import { toProfileHint } from '@/lib/profile-hint'
import { readableConvexError } from '@/lib/convex-error'
import { auth } from '@platform/auth'
import { LoginScreen } from './LoginScreen'

// Portão de autenticação: decide entre a tela de login e a aplicação real
// (children = <App /> a partir de main.tsx), e garante que `ensureUser` roda
// exatamente uma vez por transição para autenticado (não a cada render, não em loop).
// Nunca renderiza `children` sem `isAuthenticated === true` — não toca em
// components/shell/**, propriedade da Fase 3.
//
// ── AUTENTICADO NÃO BASTA: A CONTA PRECISA EXISTIR. ───────────────────────
// (Correção da tela preta do primeiro cadastro, relatada em uso real na web em
// 2026-08-25 — `.planning/quick/003-...`.)
//
// "Autenticado" e "tem linha em `users`" são DUAS coisas, e entre elas cabe uma
// corrida. O JWT do WorkOS chega válido; a linha em `users` só nasce quando
// `ensureUser` — a mutation disparada no efeito abaixo — responde. Enquanto
// isso, TODA query do app que resolve o chamador (`requireIdentity`,
// convex/lib/membership.ts) lança "Usuário sem documento em users — ensureUser
// deveria ter rodado antes". E um erro de query no Convex não é um valor: o
// `useQuery` o RELANÇA durante o render (convex/react client.js:465). Sem error
// boundary, o React desmonta a raiz — e `#root` vazio sobre um `body` com
// `bg-background` é, literalmente, uma tela preta.
//
// Quem se cadastrava pela primeira vez via exatamente isso, e o F5 consertava
// porque a mutation TINHA sido enviada antes do desmonte: no segundo
// carregamento a linha já existia.
//
// Por isso o gate tem TRÊS estados, não dois: carregando, deslogado, e
// "logado mas a conta ainda não está pronta". `children` só monta no quarto.
// O custo é um round-trip a mais na entrada (logins seguintes: `ensureUser` é
// um upsert que devolve o documento existente); o benefício é que nenhum
// componente do app precisa saber que a conta pode não existir.
//
// Vale para os DOIS alvos, e de propósito: o defeito nunca foi do alvo web —
// só apareceu lá porque foi lá que alguém se cadastrou do zero de novo.
// ──────────────────────────────────────────────────────────────────────────
//
// A DICA DE PERFIL (`profile`) É O QUE CONSERTA O NOME FEIO NA TELA.
// O access token do WorkOS — o JWT que o Convex verifica — não carrega claim
// de e-mail nem de nome, então lá dentro `identity.email` chega `undefined` e
// a derivação antiga caía no `sub` opaco (`user_01m0bc3v...`). Quem TEM o
// perfil de verdade é quem falou com a WorkOS: no Electron, o processo main,
// que recebe o objeto `User` completo do `authenticateWithCodeAndVerifier`; na
// web, o `@workos-inc/authkit-react`, que recebe o MESMO objeto no navegador.
// Os dois respondem por `auth.getProfile()` — que nunca lança, por contrato.
// Passamos isso adiante como dica; o servidor valida tudo, dá precedência a
// qualquer claim verificada e nunca deixa a dica influenciar o `workosId`
// (ver o comentário longo de `ensureUser` em convex/users.ts).
//
// Falha ao ler o perfil não bloqueia o login: `ensureUser` roda mesmo assim,
// só que com a dica vazia — o pior caso vira `usuario#1234`, renomeável.
export function AuthGate({ children }: { children: ReactNode }): React.JSX.Element {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const ensureUser = useMutation(api.users.ensureUser)

  // `accountReady` é STATE (e não mais um `ref`) porque agora ele decide o que
  // vai na tela: enquanto era só um guard interno do efeito, um ref bastava.
  const [accountReady, setAccountReady] = useState(false)
  const [accountError, setAccountError] = useState<string | null>(null)
  // O guard de "já disparei" continua sendo um ref: ele não renderiza nada, e
  // como state dispararia um setState síncrono dentro do efeito — o padrão que
  // o eslint-plugin-react-hooks (`set-state-in-effect`) sinaliza.
  const ensuringRef = useRef(false)

  // Voltar para deslogado zera o portão. Ajuste de estado DURANTE a
  // renderização, não em efeito — o mesmo padrão que `AuthWatchdog` já usa
  // (react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes),
  // e o motivo de não fazê-lo no efeito é o mesmo: `set-state-in-effect`.
  const [prevAuthenticated, setPrevAuthenticated] = useState(isAuthenticated)
  if (isAuthenticated !== prevAuthenticated) {
    setPrevAuthenticated(isAuthenticated)
    if (!isAuthenticated) {
      setAccountReady(false)
      setAccountError(null)
    }
  }

  useEffect(() => {
    if (!isAuthenticated) {
      ensuringRef.current = false
      return
    }
    if (ensuringRef.current) return
    ensuringRef.current = true
    auth
      .getProfile()
      .catch((err: unknown) => {
        console.error('Não foi possível ler o perfil do WorkOS:', err)
        return null
      })
      .then((authUser) => ensureUser({ profile: toProfileHint(authUser) }))
      .then(() => {
        setAccountReady(true)
      })
      .catch((err) => {
        // ANTES esta linha era o fim da história: o `console.error` acontecia e
        // o app seguia montado sobre uma conta inexistente, até a primeira
        // query derrubar a árvore sem dizer por quê. Agora a falha VIRA TELA.
        console.error('ensureUser falhou:', err)
        setAccountError(readableConvexError(err))
        // Solta o guard: o próximo ciclo (ou o botão "Tentar de novo") repete.
        ensuringRef.current = false
      })
    return
  }, [isAuthenticated, ensureUser])

  if (isLoading) return <TelaDeEspera>Carregando…</TelaDeEspera>
  if (!isAuthenticated) return <LoginScreen />
  if (accountError !== null) return <ContaIndisponivel motivo={accountError} />
  // Autenticado, sem erro, conta ainda não confirmada: NÃO montar `children`.
  if (!accountReady) return <TelaDeEspera>Preparando sua conta…</TelaDeEspera>
  return <>{children}</>
}

function TelaDeEspera({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      {children}
    </div>
  )
}

// A tela que a antiga "tela preta" deveria ter sido: diz o que falhou, em
// português, e oferece a saída que a pessoa ia tentar de qualquer jeito (o F5).
function ContaIndisponivel({ motivo }: { motivo: string }): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div className="flex max-w-sm flex-col items-center gap-2 text-center">
        <p className="text-sm text-destructive">Não foi possível preparar sua conta.</p>
        <p className="text-muted-foreground text-xs">{motivo}</p>
        <button
          type="button"
          className="text-muted-foreground mt-2 text-xs underline underline-offset-4"
          onClick={() => window.location.reload()}
        >
          Tentar de novo
        </button>
      </div>
    </div>
  )
}
