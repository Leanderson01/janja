import { type ReactNode, useEffect, useRef } from 'react'
import { useConvexAuth, useMutation } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import { toProfileHint } from '@/lib/profile-hint'
import { LoginScreen } from './LoginScreen'

// Portão de autenticação: decide entre a tela de login e a aplicação real
// (children = <App /> a partir de main.tsx), e garante que `ensureUser` roda
// exatamente uma vez por transição para autenticado (não a cada render, não em loop).
// Nunca renderiza `children` sem `isAuthenticated === true` — não toca em
// components/shell/**, propriedade da Fase 3.
//
// `ensuredRef` (não `useState`) porque este flag só existe para o guard interno do
// efeito, nunca para renderizar nada — usar state aqui dispararia um setState síncrono
// dentro do efeito (`if (!isAuthenticated) setEnsured(false)`), padrão que o
// eslint-plugin-react-hooks (regra `set-state-in-effect`) sinaliza como possível
// cascata de re-renders desnecessária.
//
// A DICA DE PERFIL (`profile`) É O QUE CONSERTA O NOME FEIO NA TELA.
// O access token do WorkOS — o JWT que o Convex verifica — não carrega claim
// de e-mail nem de nome, então lá dentro `identity.email` chega `undefined` e
// a derivação antiga caía no `sub` opaco (`user_01m0bc3v...`). Quem TEM o
// perfil de verdade é o processo main, que recebe o objeto `User` completo do
// `authenticateWithCodeAndVerifier` e o expõe em `window.auth.getUser()`.
// Passamos isso adiante como dica; o servidor valida tudo, dá precedência a
// qualquer claim verificada e nunca deixa a dica influenciar o `workosId`
// (ver o comentário longo de `ensureUser` em convex/users.ts).
//
// Falha ao ler o perfil não bloqueia o login: `ensureUser` roda mesmo assim,
// só que com a dica vazia — o pior caso vira `usuario#1234`, renomeável.
export function AuthGate({ children }: { children: ReactNode }): React.JSX.Element {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const ensureUser = useMutation(api.users.ensureUser)
  const ensuredRef = useRef(false)

  useEffect(() => {
    if (!isAuthenticated) {
      ensuredRef.current = false
      return
    }
    if (ensuredRef.current) return
    window.auth
      .getUser()
      .catch((err: unknown) => {
        console.error('Não foi possível ler o perfil do WorkOS:', err)
        return null
      })
      .then((authUser) => ensureUser({ profile: toProfileHint(authUser) }))
      .then(() => {
        ensuredRef.current = true
      })
      .catch((err) => console.error('ensureUser falhou:', err))
  }, [isAuthenticated, ensureUser])

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
        Carregando…
      </div>
    )
  }
  if (!isAuthenticated) return <LoginScreen />
  return <>{children}</>
}
