---
phase: 04-servidores-e-canais
plan: 05
type: execute
wave: 3
depends_on: ["04-01", "04-02"]
files_modified:
  - src/renderer/src/components/ui/dialog.tsx
  - src/renderer/src/components/ui/input.tsx
  - src/renderer/src/state/selection-context.tsx
  - src/renderer/src/components/shell/ServerRail.tsx
  - src/renderer/src/components/shell/CreateOrJoinServerDialog.tsx
autonomous: true

must_haves:
  truths:
    - "A barra de servidores mostra os servidores reais dos quais o usuário logado é membro, não mais os dois servidores mockados da Fase 3"
    - "Usuário sem nenhum servidor ainda vê a barra vazia (só o botão de adicionar), sem crash nem tela em branco"
    - "Usuário cria um servidor pela UI e passa a vê-lo na barra imediatamente, já selecionado"
    - "Usuário entra num servidor existente colando um código de convite pela UI"
  artifacts:
    - path: "src/renderer/src/state/selection-context.tsx"
      provides: "Seleção de servidor/canal derivada de dados reais do Convex (listMyServers/listChannels), não mais de mock-data.ts"
      contains: "listMyServers"
    - path: "src/renderer/src/components/shell/CreateOrJoinServerDialog.tsx"
      provides: "Dialog com duas abas: criar servidor (SRV-01) e entrar com código (SRV-03)"
      contains: "joinByCode"
    - path: "src/renderer/src/components/ui/dialog.tsx"
      provides: "Primitivo shadcn/radix-ui de Dialog, reaproveitado pelo resto da fase (planos 04-06+)"
  key_links:
    - from: "src/renderer/src/components/shell/ServerRail.tsx"
      to: "convex/servers.ts (listMyServers)"
      via: "useSelection().servers, alimentado por useQuery(api.servers.listMyServers) dentro do SelectionProvider"
      pattern: "listMyServers"
    - from: "src/renderer/src/components/shell/CreateOrJoinServerDialog.tsx"
      to: "convex/invites.ts (joinByCode) e convex/servers.ts (createServer)"
      via: "useMutation(api.invites.joinByCode) / useMutation(api.servers.createServer)"
      pattern: "useMutation"
---

<objective>
Substituir a fonte de dados da barra de servidores e do contexto de seleção — hoje
`mockServers`/`mockChannels` de `src/renderer/src/data/mock-data.ts` (Fase 3) — pelas queries
reais do Convex criadas nos planos 04-01/04-02, e dar ao usuário o primeiro ponto de entrada
real: criar um servidor ou entrar num existente por código. Este é o plano que tira o app do
estado "sempre mostra os dois servidores fictícios" e o coloca no estado real "mostra os
servidores de que este usuário logado realmente participa, inclusive zero".

Purpose: `ChannelSidebar`/`ConversationArea`/`MemberList` (planos 04-06/04-07) todos dependem
de `selectedServerId`/`selectedChannelId` já serem ids reais do Convex, não mais strings mock —
sem este plano primeiro, eles não têm o que consumir.
Output: barra de servidores funcional com dado real, contexto de seleção reescrito, e o fluxo
de criar/entrar em servidor operando de ponta a ponta pela UI.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/04-servidores-e-canais/04-RESEARCH.md
@.planning/phases/04-servidores-e-canais/04-01-schema-e-fundacao-de-servidores-PLAN.md
@.planning/phases/04-servidores-e-canais/04-02-convites-de-servidor-PLAN.md
@.planning/phases/03-shell-da-ui/03-VERIFICACAO.md
@src/renderer/src/state/selection-context.tsx
@src/renderer/src/components/shell/ServerRail.tsx
@src/renderer/src/components/ui/avatar.tsx
@src/renderer/src/components/ui/button.tsx

# Este plano assume que a Fase 2 já terminou de ponta a ponta por ora deste plano executar:
# ConvexProviderWithAuth envolve <App /> em src/renderer/src/main.tsx (plano 02-08), e existe
# um hook window.auth funcional. Confira main.tsx antes de começar — se a árvore de providers
# não estiver exatamente como descrito em 02-08, PARE e reporte como bloqueio (não é algo para
# este plano decidir sozinho).
#
# 03-VERIFICACAO.md: o CLI do shadcn escreve componentes num diretório `@/` literal na raiz do
# repo em vez de resolver o alias de import — aconteceu 3x na Fase 3. Se rodar
# `npx shadcn@latest add dialog input`, verifique o resultado e mova os arquivos para
# `src/renderer/src/components/ui/` se isso acontecer de novo. O código de Task 1 abaixo já é
# a versão final esperada, então também é válido pular o CLI e escrever os dois arquivos à mão.
#
# Caminho de import de `api`/`Id`/`Doc`: confira se `tsconfig.web.json` ganhou um alias
# `@convex/*` durante a execução do plano 02-08 (Fase 2, paralela). Se sim, use-o
# (`@convex/_generated/api`). Se não, use caminho relativo exato a partir da localização de
# cada arquivo até `convex/_generated/api`/`convex/_generated/dataModel` — mesmo padrão usado
# em `AuthGate.tsx` (plano 02-08), ajustando a contagem de `../` para a profundidade real do
# arquivo (ex: `src/renderer/src/state/selection-context.tsx` está um nível mais raso que
# `src/renderer/src/components/shell/ServerRail.tsx` — não copie a mesma contagem sem contar).
#
# mock-data.ts NÃO é apagado neste plano — ConversationArea (mensagens/voz) ainda o usa até
# F5/F7. Este plano só para de importar mockServers/mockChannels em selection-context.tsx e
# ServerRail.tsx.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Primitivos shadcn Dialog e Input</name>
  <files>src/renderer/src/components/ui/dialog.tsx, src/renderer/src/components/ui/input.tsx</files>
  <action>
    Criar `src/renderer/src/components/ui/dialog.tsx` (mesmo padrão de import de `avatar.tsx`:
    `import { Dialog as DialogPrimitive } from "radix-ui"` — pacote único `radix-ui`, não
    `@radix-ui/react-dialog` separado):
    ```tsx
    import * as React from 'react'
    import { Dialog as DialogPrimitive } from 'radix-ui'
    import { XIcon } from 'lucide-react'

    import { cn } from '@/lib/utils'

    function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
      return <DialogPrimitive.Root data-slot="dialog" {...props} />
    }

    function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
      return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
    }

    function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
      return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
    }

    function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
      return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
    }

    function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
      return (
        <DialogPrimitive.Overlay
          data-slot="dialog-overlay"
          className={cn(
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50',
            className
          )}
          {...props}
        />
      )
    }

    function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
      return (
        <DialogPortal>
          <DialogOverlay />
          <DialogPrimitive.Content
            data-slot="dialog-content"
            className={cn(
              'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg',
              className
            )}
            {...props}
          >
            {children}
            <DialogPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:pointer-events-none">
              <XIcon />
              <span className="sr-only">Fechar</span>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPortal>
      )
    }

    function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
      return <div data-slot="dialog-header" className={cn('flex flex-col gap-2 text-center sm:text-left', className)} {...props} />
    }

    function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
      return <div data-slot="dialog-footer" className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
    }

    function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
      return <DialogPrimitive.Title data-slot="dialog-title" className={cn('text-lg leading-none font-semibold', className)} {...props} />
    }

    function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
      return <DialogPrimitive.Description data-slot="dialog-description" className={cn('text-muted-foreground text-sm', className)} {...props} />
    }

    export {
      Dialog,
      DialogClose,
      DialogContent,
      DialogDescription,
      DialogFooter,
      DialogHeader,
      DialogOverlay,
      DialogPortal,
      DialogTitle,
      DialogTrigger,
    }
    ```

    Criar `src/renderer/src/components/ui/input.tsx`:
    ```tsx
    import * as React from 'react'

    import { cn } from '@/lib/utils'

    function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
      return (
        <input
          type={type}
          data-slot="input"
          className={cn(
            'border-input file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
            className
          )}
          {...props}
        />
      )
    }

    export { Input }
    ```
  </action>
  <verify>`npm run typecheck:web` reconhece os dois novos arquivos sem erro; nenhum arquivo órfão criado num diretório `@/` literal na raiz do repo (ver nota do contexto sobre o bug do CLI do shadcn).</verify>
  <done>Dialog e Input disponíveis em `@/components/ui/dialog` e `@/components/ui/input` para o resto da fase.</done>
</task>

<task type="auto">
  <name>Task 2: selection-context.tsx sobre dados reais</name>
  <files>src/renderer/src/state/selection-context.tsx</files>
  <action>
    Reescrever `src/renderer/src/state/selection-context.tsx` para derivar a seleção de
    `useQuery(api.servers.listMyServers)`/`useQuery(api.channels.listChannels, ...)` em vez de
    `mockServers`/`mockChannels`. Decisão de design: **estado derivado, sem `useEffect`** — o
    "servidor selecionado de fato" é sempre calculado a partir de "o que o usuário clicou por
    último" mais "o que existe agora", nunca sincronizado por efeito colateral (mais simples de
    testar mentalmente, evita o padrão de re-render extra de setState-dentro-de-effect):
    ```tsx
    import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
    import { useQuery } from 'convex/react'
    import { api } from '<AJUSTAR: caminho para convex/_generated/api>'
    import type { Doc, Id } from '<AJUSTAR: caminho para convex/_generated/dataModel>'

    export type SelectionContextValue = {
      servers: Doc<'servers'>[] | undefined // undefined = ainda carregando
      selectedServerId: Id<'servers'> | null // null = nenhum servidor (lista vazia)
      setSelectedServerId: (id: Id<'servers'>) => void
      selectedChannelId: Id<'channels'> | null
      setSelectedChannelId: (id: Id<'channels'>) => void
      joinedVoiceChannelId: Id<'channels'> | null
      setJoinedVoiceChannelId: (id: Id<'channels'> | null) => void
    }

    const SelectionContext = createContext<SelectionContextValue | undefined>(undefined)

    export function SelectionProvider({ children }: { children: ReactNode }): React.JSX.Element {
      const [manualServerId, setManualServerId] = useState<Id<'servers'> | null>(null)
      const [manualChannelId, setManualChannelId] = useState<Id<'channels'> | null>(null)
      const [joinedVoiceChannelId, setJoinedVoiceChannelId] = useState<Id<'channels'> | null>(null)

      const servers = useQuery(api.servers.listMyServers)

      // Servidor "efetivo": o que o usuário escolheu manualmente, SE ainda existir na lista
      // atual; senão o primeiro da lista; senão null (zero servidores). Nunca precisa de
      // useEffect — recalcula a cada render a partir do dado real mais recente.
      const selectedServerId = useMemo<Id<'servers'> | null>(() => {
        if (!servers) return null
        if (manualServerId && servers.some((s) => s._id === manualServerId)) return manualServerId
        return servers[0]?._id ?? null
      }, [servers, manualServerId])

      const channels = useQuery(
        api.channels.listChannels,
        selectedServerId ? { serverId: selectedServerId } : 'skip'
      )

      const selectedChannelId = useMemo<Id<'channels'> | null>(() => {
        if (!channels) return null
        if (manualChannelId && channels.some((c) => c._id === manualChannelId)) return manualChannelId
        const firstText = channels.find((c) => c.type === 'text')
        return firstText?._id ?? channels[0]?._id ?? null
      }, [channels, manualChannelId])

      const value = useMemo<SelectionContextValue>(
        () => ({
          servers,
          selectedServerId,
          setSelectedServerId: (id) => {
            setManualServerId(id)
            setManualChannelId(null) // força reseleção do 1º canal de texto do novo servidor
          },
          selectedChannelId,
          setSelectedChannelId: setManualChannelId,
          joinedVoiceChannelId,
          setJoinedVoiceChannelId,
        }),
        [servers, selectedServerId, selectedChannelId, joinedVoiceChannelId]
      )

      return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
    }

    export function useSelection(): SelectionContextValue {
      const context = useContext(SelectionContext)
      if (!context) {
        throw new Error('useSelection deve ser usado dentro de um SelectionProvider')
      }
      return context
    }
    ```
    Note que `selectedServerId`/`selectedChannelId` agora podem ser `null` — todo consumidor
    existente (`ServerRail`, e nos próximos planos `ChannelSidebar`/`ConversationArea`/
    `MemberList`) precisa tratar esse caso (ver Task 3 deste plano para `ServerRail`; os outros
    componentes são responsabilidade dos planos 04-06/04-07).
  </action>
  <verify>`npm run typecheck:web` passa; `selection-context.tsx` não importa mais nada de `@/data/mock-data`.</verify>
  <done>Contexto de seleção 100% orientado a dado real do Convex, com estado derivado (sem `useEffect`) e tratamento explícito do caso "zero servidores".</done>
</task>

<task type="auto">
  <name>Task 3: ServerRail real + fluxo de criar/entrar em servidor</name>
  <files>src/renderer/src/components/shell/ServerRail.tsx, src/renderer/src/components/shell/CreateOrJoinServerDialog.tsx</files>
  <action>
    Reescrever `src/renderer/src/components/shell/ServerRail.tsx`: mesma estrutura visual da
    Fase 3 (`ScrollArea` + `ServerIcon` com indicador de ativo + `Tooltip`), trocando
    `mockServers`/`Server` (de `@/data/mock-data`) por `useSelection().servers` (`Doc<'servers'>[]
    | undefined`) e `server.id` por `server._id`. Acrescentar, ao final da lista, um botão "+"
    (ícone `Plus` de `lucide-react`) que abre `CreateOrJoinServerDialog` — visível mesmo com
    zero servidores (é o único jeito de um usuário novo sair do estado vazio). Enquanto
    `servers === undefined` (carregando), renderizar só o botão "+" sem nenhum ícone de
    servidor (não travar em spinner — a lista aparece assim que a subscription resolver).

    Criar `src/renderer/src/components/shell/CreateOrJoinServerDialog.tsx`: `Dialog` com duas
    abas simples (botões de texto, sem componente de Tabs dedicado — não é necessário
    introduzir mais um primitivo shadcn para isto), "Criar" e "Entrar com código":
    - Aba "Criar": `Input` de nome (2-50 caracteres, mesma regra de `convex/servers.ts`),
      botão desabilitado enquanto `pending` ou nome inválido, chama
      `useMutation(api.servers.createServer)`.
    - Aba "Entrar com código": `Input` de código (maiúsculas, até 8 caracteres), chama
      `useMutation(api.invites.joinByCode)`.
    - Em sucesso de qualquer uma das duas: chama `setSelectedServerId(serverId)` (do
      `useSelection()`) com o id retornado pela mutation, fecha o dialog, reseta o form.
    - Em erro: mostra `err.message` (Convex propaga a mensagem lançada pela mutation, ex:
      "Convite inválido ou revogado") num texto `text-destructive`, sem fechar o dialog —
      usuário pode corrigir e tentar de novo.
    - Fechar o dialog (via `onOpenChange(false)`, incluindo clique fora/Esc do Radix) sempre
      reseta o form interno (nome, código, erro, aba ativa) — não deixar estado de uma
      tentativa anterior vazando pra próxima abertura.
  </action>
  <verify>`npm run typecheck:web` passa; `ServerRail.tsx` não importa mais `mockServers`/`Server` de `@/data/mock-data`; abrir o dialog, criar um servidor com nome válido, e ver o novo servidor aparecer na barra sem reload manual (subscription reativa do Convex faz isso sozinha).</verify>
  <done>Barra de servidores mostra dado real, com zero servidores tratado sem crash, e o fluxo de criar/entrar em servidor funcional pela UI.</done>
</task>

</tasks>

<visual_verifications>

### 1. Barra de servidores mostra servidores reais e botão de adicionar
- **URL:** tela principal do app (pós-login)
- **Viewport:** desktop
- **Element:** [data-testid não obrigatório neste projeto — visual_verification.enabled é false em .planning/config.json]
- **Expected:** Ícones de servidor reais (não mais "Galera do Sinuca"/"Dev & Café" mockados) + botão "+" ao final da lista
- **Context:** Task 3 substituiu a fonte de dados da barra de servidores

</visual_verifications>

<verification>
- `npm run typecheck` (node + web) passa.
- `npm run build` passa.
- Nenhum import de `mockServers`/`mockChannels`/`Server`/`Channel` de `@/data/mock-data` sobrevive em `selection-context.tsx` ou `ServerRail.tsx`.
- Usuário sem nenhum servidor (conta nova) vê a barra vazia + botão "+", sem tela em branco nem erro no console.
</verification>

<success_criteria>
SRV-01 e SRV-03 observáveis por um humano usando o app de verdade (não só inferidos do código):
criar servidor e entrar por código funcionam pela UI, e a barra de servidores reflete dado real
do Convex. Base pronta para os planos 04-06 (canais) e 04-07 (membros) consumirem
`selectedServerId`/`selectedChannelId` como ids reais.
</success_criteria>

<output>
After completion, create `.planning/phases/04-servidores-e-canais/04-05-SUMMARY.md`.
</output>
