---
phase: 02-convex-auth-workos
plan: 08
type: execute
wave: 5
depends_on: ["02-05", "02-06", "02-07"]
files_modified:
  - src/renderer/src/features/auth/LoginScreen.tsx
  - src/renderer/src/features/auth/AuthGate.tsx
  - src/renderer/src/features/auth/AuthWatchdog.tsx
  - src/renderer/src/main.tsx
autonomous: true

must_haves:
  truths:
    - "Usuário sem sessão vê uma tela de login com um botão 'Entrar com Google', não a aplicação"
    - "Depois do login, o app chama ensureUser uma vez e o usuário vê seu username#tag gerado"
    - "A partir do login, um heartbeat de presença roda em intervalo enquanto a sessão estiver ativa"
    - "Uma queda inesperada de isAuthenticated (Pitfall 4) é logada localmente e, se persistir, o app se recupera sozinho recarregando a janela"
  artifacts:
    - path: "src/renderer/src/main.tsx"
      provides: "ConvexProviderWithAuth envolvendo AuthGate envolvendo App — App.tsx (Fase 3) não é tocado"
      contains: "ConvexProviderWithAuth"
    - path: "src/renderer/src/features/auth/AuthGate.tsx"
      provides: "Renderiza LoginScreen ou children conforme isAuthenticated, sem tocar em components/shell/**"
    - path: "src/renderer/src/features/auth/AuthWatchdog.tsx"
      provides: "Log local de isAuthenticated caindo inesperadamente + fallback de reload silencioso (mitigação Pitfall 4)"
      contains: "isAuthenticated"
  key_links:
    - from: "src/renderer/src/features/auth/AuthGate.tsx"
      to: "convex/users.ts (ensureUser)"
      via: "useMutation(api.users.ensureUser) chamado uma vez após autenticação"
      pattern: "ensureUser"
    - from: "src/renderer/src/main.tsx"
      to: "src/renderer/src/App.tsx (Fase 3, não modificado)"
      via: "AuthGate renderiza {children} = <App />"
      pattern: "<App"
---

<objective>
Fechar o loop de ponta a ponta do lado do renderer: uma tela de login mínima (que a Fase 3
depois substitui/estiliza — este plano não entra em `components/shell/**`), o "portão" que
decide entre mostrar login ou a aplicação, a chamada de `ensureUser` no primeiro momento
autenticado, o heartbeat de presença, e o vigia de `isAuthenticated` que implementa a
mitigação do bug documentado (`get-convex/convex-backend#259`, Pitfall 4).

Purpose: é o plano que efetivamente torna AUTH-01 a AUTH-06 e a resiliência de sessão longa
(critério de sucesso 4 do ROADMAP) observáveis por um humano usando o app de verdade —
antes deste plano, tudo existia em código mas nada estava ligado na árvore React.
Output: app completo do ponto de vista de auth, pronto para o checkpoint final (02-09).
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/research/PITFALLS.md
@.planning/phases/02-convex-auth-workos/02-RESEARCH.md
@src/renderer/src/main.tsx
@src/renderer/src/App.tsx

# src/renderer/src/App.tsx JÁ EXISTE e já renderiza <AppShell /> — é propriedade da Fase 3
# (03-01 a 03-05, já em execução paralela). Este plano NÃO EDITA App.tsx nem
# components/shell/**. A integração acontece em main.tsx, que envolve <App /> com os
# providers — App.tsx continua importando/renderizando o shell exatamente como está.
#
# Pitfall 4 do PITFALLS.md: o cliente Convex pode travar em isAuthenticated:false
# permanentemente após expiração de token, mesmo com token renovado. TTL já elevado a 8h
# pelo usuário no dashboard WorkOS — este plano implementa a camada de detecção/recuperação
# que o pitfall exige mesmo assim (log local + reload como último recurso).
</context>

<tasks>

<task type="auto">
  <name>Task 1: Tela de login mínima e portão de autenticação</name>
  <files>src/renderer/src/features/auth/LoginScreen.tsx, src/renderer/src/features/auth/AuthGate.tsx</files>
  <action>
    Criar `src/renderer/src/features/auth/LoginScreen.tsx` — minimalista de propósito
    (Fase 3 cuida do visual definitivo depois; aqui só precisa ser funcional e usável para
    o checkpoint humano final desta fase). Usar os componentes shadcn/ui já disponíveis no
    projeto (`Button`, já presentes desde F0) sem depender de nenhum componente de
    `components/shell/**`:
    ```tsx
    import { Button } from '@/components/ui/button'
    import { useAuth } from '@/hooks/useAuth'
    import { useState } from 'react'

    export function LoginScreen(): React.JSX.Element {
      const { signIn } = useAuth()
      const [pending, setPending] = useState(false)

      async function handleClick(): Promise<void> {
        setPending(true)
        const result = await signIn()
        if (!result.success) setPending(false) // erro: solta o botão; sucesso: onAuthChange troca a tela
      }

      return (
        <div className="flex h-screen w-screen items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-4">
            <h1 className="text-xl font-semibold">janja</h1>
            <Button onClick={handleClick} disabled={pending}>
              {pending ? 'Abrindo o navegador…' : 'Entrar com Google'}
            </Button>
          </div>
        </div>
      )
    }
    ```
    Se o projeto não tiver `Button` em `@/components/ui/button` (verificar antes de assumir
    — foi instalado no bootstrap F0/F0-02 via shadcn), usar um `<button>` HTML simples com
    classes Tailwind equivalentes em vez de travar o plano numa dependência ausente.

    Criar `src/renderer/src/features/auth/AuthGate.tsx`:
    ```tsx
    import { type ReactNode, useEffect, useState } from 'react'
    import { useConvexAuth } from 'convex/react'
    import { useMutation } from 'convex/react'
    import { api } from '../../../../../convex/_generated/api'
    import { LoginScreen } from './LoginScreen'

    export function AuthGate({ children }: { children: ReactNode }): React.JSX.Element {
      const { isAuthenticated, isLoading } = useConvexAuth()
      const ensureUser = useMutation(api.users.ensureUser)
      const [ensured, setEnsured] = useState(false)

      useEffect(() => {
        if (isAuthenticated && !ensured) {
          ensureUser()
            .then(() => setEnsured(true))
            .catch((err) => console.error('ensureUser falhou:', err))
        }
        if (!isAuthenticated) setEnsured(false)
      }, [isAuthenticated, ensured, ensureUser])

      if (isLoading) return <div className="flex h-screen items-center justify-center">Carregando…</div>
      if (!isAuthenticated) return <LoginScreen />
      return <>{children}</>
    }
    ```
    Ajustar o caminho relativo do import de `api` conforme a profundidade real do arquivo
    (`convex/_generated/api` a partir de `src/renderer/src/features/auth/` — confirmar a
    contagem de `../` antes de finalizar, ou usar um alias de import se o `tsconfig.web.json`
    já tiver um path mapeado para `convex/*`; se não tiver, este é um bom momento para
    adicionar `"@convex/*": ["convex/*"]` aos `paths` do `tsconfig.web.json`, já que todo o
    resto de F4 em diante vai precisar importar `api` repetidamente).
  </action>
  <verify>`npm run typecheck:web` passa; `AuthGate` nunca renderiza `children` sem `isAuthenticated === true`; `ensureUser` é chamado no máximo uma vez por transição para autenticado (não em loop).</verify>
  <done>App mostra login quando deslogado e o shell (via children) quando autenticado, sem tocar em nenhum arquivo de propriedade da Fase 3.</done>
</task>

<task type="auto">
  <name>Task 2: Wiring em main.tsx e heartbeat de presença</name>
  <files>src/renderer/src/main.tsx</files>
  <action>
    Editar `src/renderer/src/main.tsx` (preservando o `createRoot`/`StrictMode`/import de
    `./assets/main.css` já existentes de F0), envolvendo `<App />` com os providers:
    ```tsx
    import './assets/main.css'

    import { StrictMode, useEffect } from 'react'
    import { createRoot } from 'react-dom/client'
    import { ConvexProviderWithAuth, useConvexAuth, useMutation } from 'convex/react'
    import { api } from '../../../convex/_generated/api'
    import App from './App'
    import { convexClient } from './lib/convex-client'
    import { useConvexAuthAdapter } from './hooks/useConvexAuthAdapter'
    import { AuthGate } from './features/auth/AuthGate'
    import { AuthWatchdog } from './features/auth/AuthWatchdog'

    function PresenceHeartbeat(): null {
      const { isAuthenticated } = useConvexAuth()
      const heartbeat = useMutation(api.presence.heartbeat)

      useEffect(() => {
        if (!isAuthenticated) return
        heartbeat().catch(() => {})
        const interval = setInterval(() => {
          heartbeat().catch(() => {})
        }, 45_000) // 45s — ver 02-RESEARCH.md §7 para o porquê deste valor
        return () => clearInterval(interval)
      }, [isAuthenticated, heartbeat])

      return null
    }

    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <ConvexProviderWithAuth client={convexClient} useAuth={useConvexAuthAdapter}>
          <AuthWatchdog />
          <AuthGate>
            <PresenceHeartbeat />
            <App />
          </AuthGate>
        </ConvexProviderWithAuth>
      </StrictMode>,
    )
    ```
    Ajustar o caminho de import de `api` da mesma forma que na Task 1 (mesma observação
    sobre alias de tsconfig, se decidido lá — manter consistência entre os dois arquivos).
  </action>
  <verify>`npm run build` (typecheck + build) passa; `npm run dev` abre o app mostrando a tela de login quando não há sessão salva.</verify>
  <done>Árvore React completa: Convex autenticado envolve o gate de login, que envolve o heartbeat de presença e o shell da Fase 3, sem nenhuma edição em App.tsx.</done>
</task>

<task type="auto">
  <name>Task 3: Vigia de isAuthenticated (mitigação Pitfall 4)</name>
  <files>src/renderer/src/features/auth/AuthWatchdog.tsx</files>
  <action>
    Criar `src/renderer/src/features/auth/AuthWatchdog.tsx` — componente sem UI, só efeito,
    montado uma vez dentro do `ConvexProviderWithAuth` (ver Task 2):
    ```tsx
    import { useConvexAuth } from 'convex/react'
    import { useEffect, useRef } from 'react'

    const RELOAD_AFTER_MS = 15_000

    export function AuthWatchdog(): null {
      const { isAuthenticated, isLoading } = useConvexAuth()
      const wasAuthenticated = useRef(false)
      const droppedAt = useRef<number | null>(null)

      useEffect(() => {
        if (isLoading) return

        if (isAuthenticated) {
          wasAuthenticated.current = true
          droppedAt.current = null
          return
        }

        // isAuthenticated caiu para false depois de já ter sido true nesta sessão do
        // processo renderer — não é o estado inicial normal de "ainda não logou".
        if (wasAuthenticated.current && droppedAt.current === null) {
          droppedAt.current = Date.now()
          console.warn(
            '[auth-watchdog] isAuthenticated caiu inesperadamente para false — possível bug get-convex/convex-backend#259. Monitorando por',
            RELOAD_AFTER_MS,
            'ms antes de recarregar.',
          )
        }
      }, [isAuthenticated, isLoading])

      useEffect(() => {
        if (droppedAt.current === null) return
        const timeout = setTimeout(() => {
          // Confirma que o main process ainda considera a sessão válida antes de recarregar
          // — evita reload em loop se o usuário realmente fez logout de propósito.
          window.auth.getUser().then((user) => {
            if (user) {
              console.warn('[auth-watchdog] isAuthenticated ainda false com sessão válida no main — recarregando janela.')
              window.location.reload()
            }
          })
        }, RELOAD_AFTER_MS)
        return () => clearTimeout(timeout)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [droppedAt.current])

      return null
    }
    ```
    O reload é deliberadamente "silencioso" (sem diálogo nem confirmação do usuário) — é a
    mitigação confirmada no PITFALLS.md (Pitfall 4, "Recovery Strategies") para este bug
    específico, não um comportamento normal de erro.
  </action>
  <verify>`npm run typecheck:web` passa; o componente não interfere quando `isAuthenticated` nunca foi `true` (estado inicial de app deslogado); só arma o temporizador de reload depois de uma transição real de true→false.</verify>
  <done>Mitigação do Pitfall 4 implementada: log observável no console em produção/dev, e recuperação automática se o cliente Convex ficar preso em não-autenticado por mais de 15s com sessão válida no main process.</done>
</task>

</tasks>

<verification>
- `npm run build` passa (typecheck completo + build do electron-vite).
- Rodar `npm run dev`: sem sessão salva, a tela de login aparece; `src/renderer/src/App.tsx` permanece byte-a-byte igual ao que a Fase 3 deixou (nenhuma edição deste plano nesse arquivo).
- `AuthWatchdog` só age depois de uma queda real de autenticado→não-autenticado, nunca no boot inicial deslogado.
</verification>

<success_criteria>
Do ponto de vista de um humano rodando o app, login/logout/persistência/geração de
username#tag/heartbeat de presença funcionam de ponta a ponta — pronto para o checkpoint
final de verificação na máquina Windows.
</success_criteria>

<output>
After completion, create `.planning/phases/02-convex-auth-workos/02-08-SUMMARY.md`.
</output>
