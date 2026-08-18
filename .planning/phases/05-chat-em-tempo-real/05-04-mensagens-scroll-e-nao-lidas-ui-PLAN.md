---
phase: 05-chat-em-tempo-real
plan: 04
type: execute
wave: 3
depends_on: ["05-01", "05-02"]
files_modified:
  - src/renderer/src/components/shell/MessageList.tsx
  - src/renderer/src/components/shell/ConversationArea.tsx
  - src/renderer/src/components/shell/ChannelSidebar.tsx
autonomous: true

must_haves:
  truths:
    - "Usuário abre um canal de texto real e vê o histórico de mensagens, mais recente embaixo, com o divisor de não lidas na posição correta se houver mensagem não lida"
    - "Usuário rola para cima e o histórico mais antigo carrega sem a posição visual pular, mesmo com mensagem nova chegando durante a rolagem"
    - "Mensagem nova não move o scroll de quem está lendo histórico antigo — em vez disso aparece um botão 'N novas mensagens' que rola até o fim ao ser clicado"
    - "A sidebar mostra a contagem real de não lidas por canal, some quando o canal é aberto e lido"
  artifacts:
    - path: "src/renderer/src/components/shell/MessageList.tsx"
      provides: "Lista de mensagens paginada e reativa (usePaginatedQuery), com âncora de scroll ao carregar histórico e aviso de mensagem nova"
      contains: "usePaginatedQuery"
    - path: "src/renderer/src/components/shell/ConversationArea.tsx"
      provides: "TextChannelView envia mensagem real via convex/messages.ts, sem mais eco local nem mockMessages"
      contains: "api.messages.sendMessage"
    - path: "src/renderer/src/components/shell/ChannelSidebar.tsx"
      provides: "Badge de não lidas por canal, alimentado por getUnreadCounts"
      contains: "getUnreadCounts"
  key_links:
    - from: "src/renderer/src/components/shell/MessageList.tsx"
      to: "convex/messages.ts (listMessages)"
      via: "usePaginatedQuery(api.messages.listMessages, { channelId }, { initialNumItems: 30 })"
      pattern: "usePaginatedQuery"
    - from: "src/renderer/src/components/shell/MessageList.tsx"
      to: "convex/channelReadState.ts (openChannel)"
      via: "useMutation(api.channelReadState.openChannel) chamado no mount do canal e sempre que mensagem nova chega com o usuário no fim do scroll"
      pattern: "openChannel"
    - from: "src/renderer/src/components/shell/ChannelSidebar.tsx"
      to: "convex/channelReadState.ts (getUnreadCounts)"
      via: "useQuery(api.channelReadState.getUnreadCounts, selectedServerId ? { serverId: selectedServerId } : 'skip')"
      pattern: "getUnreadCounts"
---

<objective>
Trocar o coração da área de conversa — hoje `mockMessages` + eco local (Fase 3) — pelas
queries e mutations reais do Convex criadas nos planos 05-01/05-02, implementando
explicitamente a técnica de âncora de scroll que evita o "pulo" ao carregar histórico
(CHAT-03) e o roubo de scroll por mensagem nova (CHAT-04), e reintroduzindo o divisor de
não lidas (CHAT-05) e o badge de contagem na sidebar (CHAT-06) — removidos como stub em
`04-06` por falta de dado real, que agora existe.

Purpose: até este plano, `ConversationArea`/`ChannelSidebar` mostram dado real de canal
(Fase 4) mas nenhuma mensagem real — este é o plano que faz o chat efetivamente
funcionar como chat, com o comportamento fino que CHAT-02/03/04/05/06 exigem, não só a
existência da feature.
Output: histórico de mensagens real e paginado, envio real, divisor de não lidas,
aviso de mensagem nova, e badge de contagem na sidebar — tudo sobre dado do Convex.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/05-chat-em-tempo-real/05-RESEARCH.md
@.planning/phases/05-chat-em-tempo-real/05-01-schema-e-mensagens-PLAN.md
@.planning/phases/05-chat-em-tempo-real/05-02-nao-lidas-backend-PLAN.md
@src/renderer/src/components/shell/MessageList.tsx
@src/renderer/src/components/shell/MessageInput.tsx
@src/renderer/src/components/shell/ConversationArea.tsx
@src/renderer/src/components/shell/ChannelSidebar.tsx
@src/renderer/src/components/ui/scroll-area.tsx
@src/renderer/src/features/auth/AuthGate.tsx

# Este plano roda depois de 04-06 (Fase 4) ter trocado ConversationArea.tsx/
# ChannelSidebar.tsx de mock-data.ts para dado real de canal — releia os dois arquivos
# como estão AGORA no disco antes de editar, a versão exata pode diferir do que está
# descrito abaixo em detalhes cosméticos (nomes de variável, formatação); o que importa é
# a estrutura: ConversationArea já resolve `channel` via
# `useQuery(api.channels.getChannel, ...)` e decide TextChannelView vs VoiceChannelView
# por `channel.type`; ChannelSidebar já lista canais reais via
# `useQuery(api.channels.listChannels, { serverId: selectedServerId })`. Se qualquer uma
# dessas duas premissas não bater com o arquivo real, PARE e reporte como bloqueio.
#
# mockMessages/mockMembers de src/renderer/src/data/mock-data.ts deixam de ser usados por
# TextChannelView (não mais necessários agora que existe dado real) — mockVoiceParticipants
# continua em VoiceChannelView (fora de escopo, F7). Não apagar mock-data.ts.
#
# Caminho de import de api/Id/Doc: mesma orientação de 04-05/04-06 — conferir se
# tsconfig.web.json ganhou um alias @convex/* desde então; se não, usar caminho relativo
# a partir de cada arquivo até convex/_generated/api|dataModel (todos os arquivos deste
# plano estão em src/renderer/src/components/shell/, mesma profundidade de
# src/renderer/src/features/auth/AuthGate.tsx — 5 níveis, '../../../../../convex/...').
#
# 05-RESEARCH.md §3/§4: leia antes de implementar Task 1 — explica exatamente por que
# mensagem nova sempre entra em results[0] (usePaginatedQuery, order desc) e por que
# histórico antigo sempre entra no fim de results, e por que isso determina qual caso
# precisa de compensação de scroll e qual não precisa.
</context>

<tasks>

<task type="auto">
  <name>Task 1: MessageList real — paginação, âncora de scroll, aviso de mensagem nova</name>
  <files>src/renderer/src/components/shell/MessageList.tsx</files>
  <action>
    Reescrever `src/renderer/src/components/shell/MessageList.tsx` por completo. O
    componente passa a ser "inteligente" (dono da própria query/mutation, mesmo padrão já
    estabelecido por `ChannelHeader.tsx` — "subscrição duplicada é esperada e barata"),
    recebendo só `channelId` como prop em vez de `messages`/`firstUnreadMessageId`:

    ```tsx
    import { useMutation, usePaginatedQuery } from 'convex/react'
    import { ArrowDown } from 'lucide-react'
    import { useEffect, useLayoutEffect, useRef, useState } from 'react'

    import { api } from '../../../../../convex/_generated/api'
    import type { Id } from '../../../../../convex/_generated/dataModel'
    import { Avatar, AvatarFallback } from '@/components/ui/avatar'
    import { Button } from '@/components/ui/button'
    import { ScrollArea } from '@/components/ui/scroll-area'
    import { Separator } from '@/components/ui/separator'

    const PAGE_SIZE = 30
    const TOP_THRESHOLD_PX = 150
    const BOTTOM_THRESHOLD_PX = 100

    const timeFormatter = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

    function initialsFor(name: string): string {
      return name.slice(0, 2).toUpperCase()
    }

    // Tipo espelha o retorno de convex/messages.ts:listMessages (plano 05-01). Se o
    // typecheck reclamar de incompatibilidade depois de qualquer ajuste no backend,
    // corrija ESTE tipo para bater com o retorno real — nunca o contrário.
    type EnrichedMessage = {
      _id: Id<'messages'>
      channelId: Id<'channels'>
      authorId: Id<'users'>
      content: string
      createdAt: number
      isMine: boolean
      author: { username: string; tag: string; displayName: string; avatarUrl?: string } | null
    }

    function UnreadDivider(): React.JSX.Element {
      return (
        <div className="flex items-center gap-2 py-1" role="separator" aria-label="Novas mensagens">
          <Separator className="flex-1 bg-red-500" />
          <span className="text-xs font-semibold text-red-500 whitespace-nowrap">NOVAS MENSAGENS</span>
          <Separator className="flex-1 bg-red-500" />
        </div>
      )
    }

    function MessageRow({ message }: { message: EnrichedMessage }): React.JSX.Element {
      const displayName = message.isMine
        ? 'Você'
        : message.author
          ? `${message.author.username}#${message.author.tag}`
          : 'Usuário desconhecido'
      const initials = message.isMine ? 'EU' : initialsFor(message.author?.username ?? '??')

      return (
        <div className="flex items-start gap-3 px-4 py-1.5 hover:bg-accent/50">
          <Avatar>
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-sm text-foreground">{displayName}</span>
              <span className="text-xs text-muted-foreground">
                {timeFormatter.format(new Date(message.createdAt))}
              </span>
            </div>
            <p className="text-sm text-foreground break-words">{message.content}</p>
          </div>
        </div>
      )
    }

    export function MessageList({ channelId }: { channelId: Id<'channels'> }): React.JSX.Element {
      const { results, status, loadMore } = usePaginatedQuery(
        api.messages.listMessages,
        { channelId },
        { initialNumItems: PAGE_SIZE }
      )
      const openChannel = useMutation(api.channelReadState.openChannel)

      const containerRef = useRef<HTMLDivElement>(null)
      const viewportRef = useRef<HTMLDivElement | null>(null)
      const isAtBottomRef = useRef(true)
      const scrollHeightBeforeLoadMoreRef = useRef<number | null>(null)
      const previousNewestIdRef = useRef<Id<'messages'> | undefined>(undefined)
      const previousOldestIdRef = useRef<Id<'messages'> | undefined>(undefined)
      const hasScrolledToBottomOnceRef = useRef(false)

      const [dividerMessageId, setDividerMessageId] = useState<Id<'messages'> | null>(null)
      const [newMessageCount, setNewMessageCount] = useState(0)

      // Snapshot único do divisor, capturado no mount deste canal — o chamador
      // (ConversationArea) remonta este componente por key={channel._id} ao trocar de
      // canal, mesmo padrão já usado desde a Fase 3 pra resetar o eco local. openChannel
      // é mutation (não query): o retorno é um valor pontual daquela chamada, nunca
      // reavalia sozinho depois (05-RESEARCH.md §5).
      useEffect(() => {
        openChannel({ channelId })
          .then((result) => setDividerMessageId(result.firstUnreadMessageId))
          .catch(() => {})
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [channelId])

      // O ScrollArea da Radix não expõe o viewport real (overflow-y:auto) por prop —
      // resolve via querySelector do data-slot, sem editar o primitivo compartilhado
      // (05-RESEARCH.md §4).
      useEffect(() => {
        const viewport = containerRef.current?.querySelector<HTMLDivElement>(
          '[data-slot="scroll-area-viewport"]'
        )
        if (!viewport) return
        viewportRef.current = viewport

        function handleScroll(): void {
          const el = viewportRef.current
          if (!el) return
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX
          isAtBottomRef.current = atBottom
          if (atBottom) setNewMessageCount(0)

          if (el.scrollTop < TOP_THRESHOLD_PX && status === 'CanLoadMore') {
            scrollHeightBeforeLoadMoreRef.current = el.scrollHeight
            loadMore(PAGE_SIZE)
          }
        }

        viewport.addEventListener('scroll', handleScroll)
        return () => viewport.removeEventListener('scroll', handleScroll)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [status])

      const messages = results as unknown as EnrichedMessage[]
      const newestId = messages[0]?._id
      const oldestId = messages[messages.length - 1]?._id
      // results[0] = mensagem mais nova (order desc do backend) — inverte pra
      // renderização top-to-bottom natural de chat. Mensagem nova sempre entra em
      // results[0] (vira o FIM da lista invertida); histórico antigo sempre entra no
      // fim de results (vira o INÍCIO da lista invertida) — ver 05-RESEARCH.md §3.
      const ordered = [...messages].reverse()

      useLayoutEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) return

        if (!hasScrolledToBottomOnceRef.current && messages.length > 0) {
          viewport.scrollTop = viewport.scrollHeight
          hasScrolledToBottomOnceRef.current = true
          previousNewestIdRef.current = newestId
          previousOldestIdRef.current = oldestId
          return
        }

        if (oldestId !== previousOldestIdRef.current && scrollHeightBeforeLoadMoreRef.current !== null) {
          const delta = viewport.scrollHeight - scrollHeightBeforeLoadMoreRef.current
          viewport.scrollTop += delta
          scrollHeightBeforeLoadMoreRef.current = null
        }

        if (newestId !== previousNewestIdRef.current && previousNewestIdRef.current !== undefined) {
          if (isAtBottomRef.current) {
            viewport.scrollTop = viewport.scrollHeight
            openChannel({ channelId }).catch(() => {})
          } else {
            setNewMessageCount((n) => n + 1)
          }
        }

        previousNewestIdRef.current = newestId
        previousOldestIdRef.current = oldestId
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [newestId, oldestId])

      function scrollToBottom(): void {
        const viewport = viewportRef.current
        if (!viewport) return
        viewport.scrollTop = viewport.scrollHeight
        setNewMessageCount(0)
        isAtBottomRef.current = true
        openChannel({ channelId }).catch(() => {})
      }

      if (status === 'LoadingFirstPage') {
        return (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Carregando mensagens...
          </div>
        )
      }

      if (messages.length === 0) {
        return (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Nenhuma mensagem ainda
          </div>
        )
      }

      return (
        <div ref={containerRef} className="relative h-full">
          <ScrollArea className="h-full">
            <div className="flex flex-col py-2">
              {ordered.map((message) => (
                <div key={message._id}>
                  {message._id === dividerMessageId ? <UnreadDivider /> : null}
                  <MessageRow message={message} />
                </div>
              ))}
            </div>
          </ScrollArea>

          {newMessageCount > 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
              <Button size="sm" variant="secondary" className="shadow-md" onClick={scrollToBottom}>
                {newMessageCount === 1 ? '1 nova mensagem' : `${newMessageCount} novas mensagens`}
                <ArrowDown className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      )
    }
    ```

    Pontos que não são negociáveis (verificados no checklist abaixo):
    - `previousNewestIdRef.current !== undefined` na condição de mensagem nova evita
      tratar o primeiro carregamento do canal como "mensagem nova" (o bloco de primeiro
      carregamento, acima, já trata e faz `return` antes de chegar ali de qualquer forma,
      mas a guarda extra deixa a intenção explícita).
    - Nenhum `useEffect`/`useLayoutEffect` chama `loadMore` a partir de `results.length`
      — o gatilho de carregar histórico é exclusivamente o evento de `scroll` nativo
      (`scrollTop < TOP_THRESHOLD_PX`), nunca uma reação a dado chegando.
    - `messages.length > 0` (não `results.length`) é a mesma referência convertida —
      manter os dois nomes consistentes ao copiar o código (não deixar `results.length`
      solto depois do `as EnrichedMessage[]`).
  </action>
  <verify>
    `npm run typecheck:web` passa. Teste manual (dev, uma conta): abrir um canal de texto
    com 0 mensagens mostra "Nenhuma mensagem ainda"; enviar uma mensagem faz a lista
    aparecer com a mensagem no fim, `isMine`/"Você" corretos. Inspecionar
    `MessageList.tsx`: nenhuma importação de `mock-data`.
  </verify>
  <done>
    Lista de mensagens paginada, reativa, com scroll ancorado ao carregar histórico e
    aviso de mensagem nova quando o usuário não está no fim — pronta para ser consumida
    só com `channelId`.
  </done>
</task>

<task type="auto">
  <name>Task 2: ConversationArea envia mensagem real, sem eco local</name>
  <files>src/renderer/src/components/shell/ConversationArea.tsx</files>
  <action>
    Reler o arquivo como está no disco (pós Fase 4/06). Dentro dele, `TextChannelView`
    (ou equivalente pós-04-06) hoje monta `mockMessages`/estado `sentMessages` local e
    passa `messages`/`firstUnreadMessageId` para `MessageList`. Substituir por:

    ```tsx
    function TextChannelView({ channelId }: { channelId: Id<'channels'> }): React.JSX.Element {
      const sendMessage = useMutation(api.messages.sendMessage)

      function handleSend(content: string): void {
        sendMessage({ channelId, content }).catch(() => {})
      }

      return (
        <>
          <div className="flex-1 min-h-0">
            <MessageList channelId={channelId} />
          </div>
          <MessageInput onSend={handleSend} />
        </>
      )
    }
    ```

    Remover: o `useState<Message[]>` de eco local, o filtro/sort sobre `mockMessages`, e
    a prop `firstUnreadMessageId` (o divisor agora é 100% interno a `MessageList`, não
    depende mais de nada vindo de `mock-data.ts`). No componente pai (`ConversationArea`),
    trocar a chamada `<TextChannelView key={channel.id} channelId={channel.id}
    firstUnreadMessageId={channel.firstUnreadMessageId} />` (ou o equivalente com
    `channel._id`, dependendo de como 04-06 nomeou) por
    `<TextChannelView key={channel._id} channelId={channel._id} />` — manter o `key`
    (é o que garante o remount/reset ao trocar de canal).

    Adicionar aos imports: `useMutation` de `convex/react`, `api` de
    `convex/_generated/api` (caminho relativo, mesma orientação do contexto deste plano —
    se `ConversationArea.tsx` já importa `api` por causa de `getChannel`, reaproveitar o
    import existente, não duplicar).

    `mockMessages`/`Message` de `@/data/mock-data` deixam de ser usados por
    `TextChannelView` — se não forem usados em mais nenhum lugar do arquivo (confirmar:
    `VoiceChannelView` usa `mockVoiceParticipants`/`mockMembers`, não `mockMessages`),
    remover o import não utilizado.
  </action>
  <verify>
    `npm run typecheck:web` passa; `ConversationArea.tsx` não importa mais `mockMessages`
    nem `Message` de `@/data/mock-data`. Teste manual: digitar uma mensagem e apertar
    Enter faz ela aparecer na lista (via `MessageList`, reativo), campo de texto limpa.
  </verify>
  <done>
    Envio de mensagem passa pelo backend real; nenhum estado de eco local sobrevive à
    troca de canal nem a um recarregamento.
  </done>
</task>

<task type="auto">
  <name>Task 3: Badge de contagem de não lidas na sidebar</name>
  <files>src/renderer/src/components/shell/ChannelSidebar.tsx</files>
  <action>
    Reler o arquivo como está no disco (pós 04-06 — já lista canais reais, sem badge,
    conforme o corte explícito daquele plano). Acrescentar:

    ```tsx
    const unreadCounts = useQuery(
      api.channelReadState.getUnreadCounts,
      selectedServerId ? { serverId: selectedServerId } : 'skip'
    )
    const unreadByChannel = new Map((unreadCounts ?? []).map((u) => [u.channelId, u.unreadCount]))
    ```

    Passar `unreadCount={unreadByChannel.get(channel._id) ?? 0}` para `TextChannelRow`
    (ou equivalente pós-04-06) e reintroduzir a renderização condicional do `Badge`
    (removida em 04-06 por falta de dado real):
    ```tsx
    {unreadCount > 0 && (
      <Badge variant="secondary" className="shrink-0">
        {unreadCount}
      </Badge>
    )}
    ```
    `Badge` já está importado em `@/components/ui/badge` (mesmo import que 04-06 pode ter
    deixado comentado/removido — conferir e restaurar se necessário). Canal de voz não
    ganha badge (a query já filtra só canais de texto — `getUnreadCounts` nunca retorna
    entrada para canal de voz).
  </action>
  <verify>
    `npm run typecheck:web` passa. Teste manual: enviar mensagem em um canal enquanto
    outro canal do mesmo servidor está selecionado faz o badge aparecer no canal que
    recebeu a mensagem; abrir esse canal faz o badge sumir (via `openChannel`, chamado
    pelo mount de `MessageList`, Task 1).
  </verify>
  <done>
    Sidebar mostra contagem real de não lidas por canal, atualizada reativamente sem
    reload.
  </done>
</task>

</tasks>

<visual_verifications>

### 1. Histórico de mensagens com divisor de não lidas
- **URL:** tela principal do app, canal de texto com mensagens não lidas
- **Viewport:** desktop
- **Element:** [role="separator"][aria-label="Novas mensagens"]
- **Expected:** Linha "NOVAS MENSAGENS" visível imediatamente antes da primeira mensagem não lida
- **Context:** Task 1 reintroduziu o divisor sobre dado real

### 2. Aviso de mensagem nova não rouba o scroll
- **URL:** tela principal do app, canal de texto, scroll no meio do histórico
- **Viewport:** desktop
- **Expected:** Botão flutuante "N novas mensagens" no rodapé da lista, scroll permanece na posição atual até o clique
- **Context:** Task 1 implementou a técnica de âncora + aviso

### 3. Badge de não lidas na sidebar
- **URL:** tela principal do app, sidebar de canais com mensagem não lida em outro canal
- **Viewport:** desktop
- **Element:** sidebar de canais, badge numérico ao lado do nome do canal
- **Expected:** Número visível, some ao abrir o canal correspondente
- **Context:** Task 3 reintroduziu o badge sobre dado real

</visual_verifications>

<verification>
- `npm run typecheck:web` passa.
- `npm run build` passa.
- Nenhum dos 3 arquivos importa `mockMessages`/`Message` de `@/data/mock-data`.
- Fluxo manual completo (dev, uma conta): abrir canal → ver histórico (ou "Nenhuma
  mensagem ainda") → enviar mensagem → aparece no fim → rolar até o topo com histórico
  suficiente (30+ mensagens, pode ser necessário enviar várias de teste) → carrega mais
  sem pular a posição visual.
</verification>

<success_criteria>
CHAT-01, CHAT-03, CHAT-04, CHAT-05 e CHAT-06 observáveis por um humano usando o app —
falta só a verificação com duas contas simultâneas (latência CHAT-02, comportamento de
scroll com mensagem concorrente de verdade), que é o plano 05-06.
</success_criteria>

<output>
After completion, create `.planning/phases/05-chat-em-tempo-real/05-04-SUMMARY.md`.
</output>
