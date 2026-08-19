import { useMutation, usePaginatedQuery } from 'convex/react'
import { ArrowDown } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

const PAGE_SIZE = 30
const TOP_THRESHOLD_PX = 150
const BOTTOM_THRESHOLD_PX = 100
// Folga acima do divisor de não lidas (05-07-PLAN.md) — deixa uma mensagem lida
// espiando acima, para o usuário perceber que há contexto anterior.
const DIVIDER_SCROLL_PADDING_PX = 96

const timeFormatter = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

function initialsFor(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

// Tipo espelha o retorno de convex/messages.ts:listMessages (planos 05-01/05-02) — cada
// item da página já vem enriquecido com o autor e `isMine`, computados no servidor. Se o
// typecheck reclamar de incompatibilidade depois de qualquer ajuste no backend, corrigir
// ESTE tipo para bater com o retorno real, nunca o contrário.
type EnrichedMessage = {
  _id: Id<'messages'>
  channelId: Id<'channels'>
  content: string
  createdAt: number
  isMine: boolean
  author: {
    userId: Id<'users'>
    username: string
    tag: string
    displayName: string
    avatarUrl?: string
  } | null
}

// Divisor "novas mensagens" (CHAT-05) — linha horizontal com rótulo
// centralizado em cor de destaque, imediatamente antes da mensagem marcada
// como primeira não lida pela mutation openChannel.
function UnreadDivider(): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-2 py-1"
      role="separator"
      aria-label="Novas mensagens"
      data-unread-divider="true"
    >
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

// Lista rolável de mensagens (RESEARCH.md §3: `flex-1 min-h-0` no wrapper do
// pai + `overflow-y-auto` aqui, via ScrollArea). A partir deste plano é
// "inteligente" — dona da própria query/mutation (mesmo padrão de
// ChannelHeader.tsx: subscrição duplicada é esperada e barata), recebe só
// `channelId` como prop.
//
// Comportamento de scroll (05-RESEARCH.md §3/§4 — a parte difícil desta
// fase, CHAT-03/CHAT-04): `usePaginatedQuery` com `order('desc')` no
// backend garante que mensagem nova sempre entra em `results[0]` (vira o
// FIM da lista invertida — nunca desloca o que já estava acima) e que
// histórico antigo carregado via `loadMore` sempre entra no FIM de
// `results` (vira o INÍCIO da lista invertida — sempre aparece acima do que
// já estava visível, exigindo compensação manual de `scrollHeight`). O
// gatilho de `loadMore` é exclusivamente o evento de `scroll` nativo
// (`scrollTop < TOP_THRESHOLD_PX`) — nunca uma reação a `results.length`
// mudando, que reagiria também a mensagens novas chegando.
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

  // `undefined` = openChannel ainda não resolveu (posição inicial do scroll aguarda —
  // ver useLayoutEffect abaixo); `null` = resolveu e não há não lida; `Id` = resolveu
  // com uma primeira não lida. Distinguir "ainda não sei" de "sei que não há" é o que
  // evita decidir a posição inicial cedo demais (05-07-PLAN.md).
  const [dividerMessageId, setDividerMessageId] = useState<Id<'messages'> | null | undefined>(
    undefined
  )
  const [newMessageCount, setNewMessageCount] = useState(0)

  // Snapshot único do divisor, capturado no mount deste canal — o chamador
  // (ConversationArea) remonta este componente por key={channel._id} ao trocar de
  // canal, mesmo padrão já usado desde a Fase 3 pra resetar o eco local. openChannel
  // é mutation (não query): o retorno é um valor pontual daquela chamada, nunca
  // reavalia sozinho depois (05-RESEARCH.md §5). Se a mutation falhar (offline, etc.),
  // cai para `null` (sem divisor) em vez de deixar a posição inicial travada para
  // sempre em "aguardando" — mesmo raciocínio de fallback decisivo do 05-07-PLAN.md.
  useEffect(() => {
    openChannel({ channelId })
      .then((result) => setDividerMessageId(result.firstUnreadMessageId))
      .catch(() => setDividerMessageId(null))
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
    // Autossuficiente: não depende do outro efeito (abaixo, que só liga o listener de
    // scroll) ter rodado antes para popular `viewportRef`. Aquele é `useEffect`
    // (passivo, roda depois da pintura); este é `useLayoutEffect` (roda antes da
    // pintura, logo após o commit do DOM) — na primeira vez que o container real
    // monta (troca de "Carregando mensagens..." pro ScrollArea), este efeito roda
    // ANTES do outro, então `viewportRef.current` ainda estaria vazio se só lêssemos
    // o ref. Buscar direto aqui (com fallback pro ref já resolvido, pra não repetir o
    // querySelector todo render) é o que corrige o defeito relatado pelo Leo: sem
    // isso, o scroll nunca era setado no mount e ficava em 0 (topo), uma posição sem
    // significado.
    const viewport =
      viewportRef.current ??
      containerRef.current?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]') ??
      null
    if (!viewport) return
    viewportRef.current = viewport

    if (!hasScrolledToBottomOnceRef.current) {
      if (messages.length === 0) return
      // openChannel ainda não resolveu — não decide a posição inicial com dado
      // incompleto. Se decidíssemos aqui (tratando "ainda não sei" como "não há
      // divisor"), `hasScrolledToBottomOnceRef` viraria `true` e a correção certa,
      // quando o divisor chegasse depois, nunca rodaria de novo.
      if (dividerMessageId === undefined) return

      const dividerEl = containerRef.current?.querySelector<HTMLDivElement>(
        '[data-unread-divider="true"]'
      )

      if (dividerEl) {
        // Primeira não lida está na página carregada — rola até ela com folga acima
        // (CHAT-14: divisor visível, contexto anterior espiando).
        const offset =
          dividerEl.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top +
          viewport.scrollTop
        viewport.scrollTop = Math.max(0, offset - DIVIDER_SCROLL_PADDING_PX)
      } else {
        // Tudo lido (dividerMessageId === null) OU a primeira não lida está fora da
        // página carregada (30 mensagens) — em ambos os casos vai para o fim, em vez
        // de carregar páginas em cadeia atrás dela (limitação conhecida, 05-07-PLAN.md).
        viewport.scrollTop = viewport.scrollHeight
      }

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
  }, [newestId, oldestId, dividerMessageId])

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
