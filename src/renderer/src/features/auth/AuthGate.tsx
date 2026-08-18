import { type ReactNode, useEffect, useRef } from 'react'
import { useConvexAuth, useMutation } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
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
    ensureUser()
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
