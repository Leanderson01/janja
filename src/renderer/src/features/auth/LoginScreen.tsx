import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'

// Tela de login minimalista de propósito — a Fase 3 (components/shell/**) cuida do
// visual definitivo depois. Aqui só precisa ser funcional/usável para o checkpoint
// humano final desta fase (02-09). Não importa nada de components/shell/**.
export function LoginScreen(): React.JSX.Element {
  const { signIn } = useAuth()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick(): Promise<void> {
    setPending(true)
    setError(null)
    const result = await signIn()
    // Em caso de sucesso, o main process dispara onAuthChange e o AuthGate troca a
    // tela sozinho — não há nada a fazer aqui além de soltar o botão em caso de erro.
    if (!result.success) {
      setPending(false)
      setError(result.error ?? 'Falha ao entrar. Tente novamente.')
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-xl font-semibold">janja</h1>
        <Button onClick={handleClick} disabled={pending}>
          {pending ? 'Abrindo o navegador…' : 'Entrar com Google'}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}
