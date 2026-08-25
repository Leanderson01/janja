import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexProviderWithAuth } from 'convex/react'
import App from './App'
import { convexClient, isConvexConfigured } from './lib/convex-client'
import { AuthGate } from './features/auth/AuthGate'
import { AuthWatchdog } from './features/auth/AuthWatchdog'
import { PresenceHeartbeat } from './features/auth/PresenceHeartbeat'
import { HydraMark } from '@/components/brand/HydraMark'
import { RootErrorBoundary } from '@/components/boundary/RootErrorBoundary'
// Primeiro consumidor real do alias `@platform` (Fase 10): resolve para
// `platform/electron` sob `electron.vite.config.ts` e para `platform/web` sob
// `vite.config.web.ts`. E o que da sentido a `scripts/verify-web-bundle.mjs` —
// sem NENHUM consumidor, o lado escolhido nao entra no bundle e nao ha o que
// afirmar sobre o artefato.
import { capabilities } from '@platform/capabilities'
// A costura de autenticação, escolhida pelo mesmo alias: no Electron o
// `AuthProvider` é transparente e o token vem do processo main por IPC; na web
// é o `<AuthKitProvider devMode>` e o token vem do `@workos-inc/authkit-react`.
// `isAuthConfigured` existe dos dois lados para esta decisão não precisar de um
// `if (isElectron)` — ver `platform/electron/auth.tsx` e `platform/web/auth.tsx`.
import { auth, isAuthConfigured } from '@platform/auth'

// Tela mínima e autocontida — não depende de nenhum componente que precise do
// Convex já montado (não pode: é exibida exatamente quando o Convex não está
// configurado) nem do provider de autenticação (idem). Mesmo padrão já em vigor
// para MAIN_VITE_WORKOS_CLIENT_ID ausente (ver src/main/auth/auth.ts,
// AuthNotConfiguredError): mensagem legível em português em vez de um popup de
// exceção com stack trace de node_modules.
//
// Recebe a variável que falta em vez de nomeá-la fixa porque agora são DUAS: o
// alvo web também precisa de VITE_WORKOS_CLIENT_ID, e um build sem ela chegaria
// aqui em branco, ou pior, com um erro de `clientId` vindo de dentro do
// node_modules do AuthKit.
function NotConfiguredScreen({ missingVar }: { missingVar: string }): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <div className="flex max-w-sm flex-col items-center gap-2 text-center">
        <HydraMark className="size-10" />
        <h1 className="text-xl font-semibold tracking-tight">Hydra</h1>
        <p className="text-sm text-destructive">
          Configuração incompleta: {missingVar} não definida.
        </p>
        <p className="text-muted-foreground text-xs">
          Este build não foi gerado corretamente — contate quem fez o empacotamento.
        </p>
      </div>
    </div>
  )
}

// A ÁRVORE, E POR QUE ELA ESTÁ NESTA ORDEM.
//
// `auth.AuthProvider` fica POR FORA do `ConvexProviderWithAuth`: o adaptador
// que o Convex recebe chama o `useAuth()` do AuthKit, que exige o contexto já
// montado. Invertido, o primeiro render morre com "useAuth must be used within
// AuthKitProvider" — e no Electron isso NÃO apareceria, porque lá o provider é
// um fragmento. É a forma exata de bug que só existe num alvo, e por isso a
// ordem está escrita aqui em vez de descoberta no navegador.
//
// No caminho Electron a árvore continua idêntica à de antes desta fase.
function appTree(): React.JSX.Element {
  if (!isConvexConfigured || !convexClient)
    return <NotConfiguredScreen missingVar="VITE_CONVEX_URL" />
  if (!isAuthConfigured) return <NotConfiguredScreen missingVar="VITE_WORKOS_CLIENT_ID" />
  return (
    <auth.AuthProvider>
      <ConvexProviderWithAuth client={convexClient} useAuth={auth.useConvexAuthAdapter}>
        <AuthWatchdog />
        <AuthGate>
          <PresenceHeartbeat />
          <App />
        </AuthGate>
      </ConvexProviderWithAuth>
    </auth.AuthProvider>
  )
}

// Log de boot: em qualquer relato de bug a primeira pergunta passa a ter
// resposta na primeira linha do console — qual alvo esta rodando.
console.info('[platform]', capabilities.target, capabilities.buildTargetSentinel)

// `RootErrorBoundary` POR FORA DE TUDO, inclusive das telas de configuração
// incompleta. É o único lugar da árvore onde um erro de render vira texto em
// vez de uma raiz vazia — e raiz vazia aqui é a TELA PRETA que o primeiro
// cadastro na web produziu em 2026-08-25 (a causa daquele caso está corrigida
// em `AuthGate`; isto é a rede para o próximo). Inerte enquanto nada lança:
// renderiza `children` e nada mais, então a árvore do desktop continua a
// mesma.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>{appTree()}</RootErrorBoundary>
  </StrictMode>
)
