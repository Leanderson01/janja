import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexProviderWithAuth } from 'convex/react'
import App from './App'
import { convexClient, isConvexConfigured } from './lib/convex-client'
import { useConvexAuthAdapter } from './hooks/useConvexAuthAdapter'
import { AuthGate } from './features/auth/AuthGate'
import { AuthWatchdog } from './features/auth/AuthWatchdog'
import { PresenceHeartbeat } from './features/auth/PresenceHeartbeat'
import { HydraMark } from '@/components/brand/HydraMark'
// Primeiro consumidor real do alias `@platform` (Fase 10): resolve para
// `platform/electron` sob `electron.vite.config.ts` e para `platform/web` sob
// `vite.config.web.ts`. E o que da sentido a `scripts/verify-web-bundle.mjs` —
// sem NENHUM consumidor, o lado escolhido nao entra no bundle e nao ha o que
// afirmar sobre o artefato.
import { capabilities } from '@platform/capabilities'

// Tela mínima e autocontida — não depende de nenhum componente que precise do
// Convex já montado (não pode: é exibida exatamente quando o Convex não está
// configurado). Mesmo padrão já em vigor para MAIN_VITE_WORKOS_CLIENT_ID ausente
// (ver src/main/auth/auth.ts, AuthNotConfiguredError): mensagem legível em
// português em vez de um popup de exceção com stack trace de node_modules.
function ConvexNotConfiguredScreen(): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div className="flex max-w-sm flex-col items-center gap-2 text-center">
        <HydraMark className="size-10" />
        <h1 className="text-xl font-semibold tracking-tight">Hydra</h1>
        <p className="text-sm text-destructive">
          Configuração incompleta: VITE_CONVEX_URL não definida.
        </p>
        <p className="text-muted-foreground text-xs">
          Este build não foi gerado corretamente — contate quem fez o empacotamento.
        </p>
      </div>
    </div>
  )
}

// Log de boot: em qualquer relato de bug a primeira pergunta passa a ter
// resposta na primeira linha do console — qual alvo esta rodando.
console.info('[platform]', capabilities.target, capabilities.buildTargetSentinel)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isConvexConfigured && convexClient ? (
      <ConvexProviderWithAuth client={convexClient} useAuth={useConvexAuthAdapter}>
        <AuthWatchdog />
        <AuthGate>
          <PresenceHeartbeat />
          <App />
        </AuthGate>
      </ConvexProviderWithAuth>
    ) : (
      <ConvexNotConfiguredScreen />
    )}
  </StrictMode>
)
