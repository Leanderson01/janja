import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { HydraMark } from '@/components/brand/HydraMark'
import { capabilities } from '@platform/capabilities'

// Tela de login minimalista de propósito — a Fase 3 (components/shell/**) cuida do
// visual definitivo depois. Aqui só precisa ser funcional/usável para o checkpoint
// humano final desta fase (02-09). Não importa nada de components/shell/**.
export function LoginScreen(): React.JSX.Element {
  const { signIn, error: sessionError } = useAuth()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick(): Promise<void> {
    setPending(true)
    setError(null)
    try {
      await signIn()
      // Em caso de sucesso NÃO soltamos o botão de propósito, nos dois alvos: no
      // Electron o processo main dispara `onAuthChange` e o `AuthGate` troca a
      // tela sozinho; na web esta própria aba navega para a WorkOS e não volta.
    } catch (err: unknown) {
      // `signIn()` do contrato LANÇA em vez de devolver `{ success, error }` — a
      // mensagem exibida continua sendo exatamente a mesma de antes (o
      // `result.error` do IPC virou a `message` do Error em
      // `platform/electron/auth.tsx`).
      setPending(false)
      setError(err instanceof Error ? err.message : 'Falha ao entrar. Tente novamente.')
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-4">
        <HydraMark className="size-12" />
        <h1 className="text-xl font-semibold tracking-tight">Hydra</h1>
        <Button onClick={handleClick} disabled={pending}>
          {/* Paridade DECLARADA, não string duplicada por tela: quem abre um
              navegador externo (e volta por deep link) é só o alvo com
              integração de desktop. Na web, quem navega é esta própria aba. */}
          {pending
            ? capabilities.desktopIntegration
              ? 'Abrindo o navegador…'
              : 'Redirecionando…'
            : 'Entrar com Google'}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Erro de sessão vindo da plataforma — no Electron, do processo main
            (ex.: app sem MAIN_VITE_WORKOS_CLIENT_ID). Antes isso travava o app
            numa tela "Carregando…" eterna; agora a pessoa pelo menos lê qual é o
            problema em vez de encarar uma tela morta. Na web este campo é sempre
            `null`: configuração ausente vira a tela de `main.tsx`. */}
        {sessionError && (
          <p className="text-muted-foreground max-w-sm text-center text-xs">{sessionError}</p>
        )}
      </div>
    </div>
  )
}
