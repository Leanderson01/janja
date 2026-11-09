import { useMutation, usePaginatedQuery } from 'convex/react'
import { File, FileX, Hash } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import {
  ChannelWelcome,
  DaySeparator,
  JumpToPresentBar,
  UnreadDivider
} from '@/components/shell/ChatChrome'
import { LinkPreviewCard } from '@/components/shell/LinkPreviewCard'
import { MessageRowView, MessageText } from '@/components/shell/MessageRowView'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useChatScroll } from '@/hooks/useChatScroll'
import { formatBytes, isImage } from '@/lib/attachments'
import { displayNameOf } from '@/lib/display-name'
import { buildTimeline } from '@/lib/message-grouping'
import { firstLinkOf } from '@/lib/message-links'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

const PAGE_SIZE = 30
// Folga acima do divisor de não lidas (05-07-PLAN.md) — deixa uma mensagem lida
// espiando acima, para o usuário perceber que há contexto anterior.
const DIVIDER_SCROLL_PADDING_PX = 96

// Atualização do "agora" que alimenta Hoje/Ontem nos horários.
const NOW_TICK_MS = 60_000

// Tipo espelha o retorno de convex/messages.ts:listMessages (planos 05-01/05-02) — cada
// item da página já vem enriquecido com o autor e `isMine`, computados no servidor. Se o
// typecheck reclamar de incompatibilidade depois de qualquer ajuste no backend, corrigir
// ESTE tipo para bater com o retorno real, nunca o contrário.

// CHAT-10 (Plano 08.5-14). `url` é `string | null` porque `listMessages` chama
// `storage.getUrl`, que devolve `null` quando o arquivo sumiu do storage — e
// isso NÃO é erro, é o estado normal de leitura de um anexo apagado
// (08.5-13-SUMMARY.md). `contentType` é opcional porque o storage pode não ter
// recebido `Content-Type` no upload.
type MessageAttachment = {
  storageId: Id<'_storage'>
  name: string
  size: number
  contentType?: string
  url: string | null
}

type EnrichedMessage = {
  _id: Id<'messages'>
  channelId: Id<'channels'>
  content: string
  createdAt: number
  isMine: boolean
  attachments: MessageAttachment[]
  author: {
    userId: Id<'users'>
    username: string
    tag: string
    displayName: string
    avatarUrl?: string
  } | null
}

// Um anexo dentro da mensagem. Três caminhos, e o primeiro é o que existe por
// decisão explícita do CONTEXT.md desta fase:
//
// 1. `url === null` — o arquivo sumiu do storage. Bloco discreto com o nome e
//    "Arquivo indisponível". NUNCA `<img src={null}>` nem link morto: os dois
//    dariam ícone de imagem quebrada ou uma aba em branco, e o usuário ficaria
//    achando que o app está com defeito em vez de entender que o arquivo não
//    existe mais. Este caso não é raridade de teste — é o que todo mundo vai
//    ver no dia em que a cota do storage for limpa.
// 2. Imagem — embutida, dentro de um link para abrir em tamanho real.
// 3. Qualquer outra coisa (inclusive SVG, de propósito — ver `isImage`) —
//    cartão com ícone, nome e tamanho.
function AttachmentItem({ attachment }: { attachment: MessageAttachment }): React.JSX.Element {
  if (attachment.url === null) {
    return (
      <div className="flex w-fit max-w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-muted-foreground">
        <FileX className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate text-sm">{attachment.name}</span>
        <span className="shrink-0 text-xs">Arquivo indisponível</span>
      </div>
    )
  }

  // `target="_blank"` + `rel="noreferrer"`: o `setWindowOpenHandler` do
  // processo main (src/main/index.ts) já manda link externo para
  // `shell.openExternal`, então o arquivo abre no navegador do sistema e não
  // numa janela do Electron. Não é preciso mexer no main por causa disto.
  if (isImage(attachment.contentType)) {
    return (
      <a href={attachment.url} target="_blank" rel="noreferrer" className="block w-fit">
        <img
          src={attachment.url}
          alt={attachment.name}
          loading="lazy"
          className="max-h-80 max-w-full rounded-md"
        />
      </a>
    )
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className="flex w-fit max-w-full items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 hover:bg-accent/50"
    >
      <File className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{attachment.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(attachment.size)}</span>
    </a>
  )
}

// Vários anexos empilham. Não existe galeria/grade, de propósito: o limite é 5
// por mensagem, e uma grade só acrescentaria layout para resolver um problema
// que não aparece nesse volume.
function MessageAttachments({
  attachments
}: {
  attachments: MessageAttachment[]
}): React.JSX.Element | null {
  if (attachments.length === 0) return null

  return (
    <div className="mt-1 flex flex-col gap-2">
      {attachments.map((attachment, index) => (
        <AttachmentItem key={`${attachment.storageId}-${index}`} attachment={attachment} />
      ))}
    </div>
  )
}

function MessageContent({ message }: { message: EnrichedMessage }): React.JSX.Element {
  // CHAT-15 (Plano 08.5-16). `firstLinkOf` é pura, só olha a string e devolve
  // no máximo uma URL — chamar por mensagem renderizada é barato. Mensagem sem
  // link devolve `null` aqui e o componente de prévia NÃO É MONTADO: nenhuma
  // subscription é aberta, nenhuma chamada de servidor acontece. É esse detalhe
  // que torna a feature aceitável numa lista paginada de 30 em 30 mensagens.
  const link = firstLinkOf(message.content)

  return (
    <>
      {/* Mensagem só com anexo tem `content` vazio — o caso normal de mandar
          uma imagem. Sem esta guarda, uma linha de texto vazia ficaria ocupando
          altura entre o cabeçalho e a imagem. */}
      {message.content.length > 0 && <MessageText>{message.content}</MessageText>}
      {/* Ordem visual: texto → prévia do link → anexos. O anexo é conteúdo
          que a pessoa mandou; a prévia é enfeite derivado do texto, e por
          isso fica antes — para não separar a mensagem do que ela carrega. */}
      {link ? <LinkPreviewCard url={link} /> : null}
      <MessageAttachments attachments={message.attachments} />
    </>
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
export function MessageList({
  channelId,
  channelName,
  nicknameByUserId
}: {
  channelId: Id<'channels'>
  channelName?: string
  nicknameByUserId: Map<string, string>
}): React.JSX.Element {
  const { results, status, loadMore } = usePaginatedQuery(
    api.messages.listMessages,
    { channelId },
    { initialNumItems: PAGE_SIZE }
  )
  const openChannel = useMutation(api.channelReadState.openChannel)

  const containerRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  // `undefined` = openChannel ainda não resolveu (posição inicial do scroll aguarda —
  // ver useChatScroll); `null` = resolveu e não há não lida; `Id` = resolveu
  // com uma primeira não lida. Distinguir "ainda não sei" de "sei que não há" é o que
  // evita decidir a posição inicial cedo demais (05-07-PLAN.md).
  const [dividerMessageId, setDividerMessageId] = useState<Id<'messages'> | null | undefined>(
    undefined
  )
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), NOW_TICK_MS)
    return () => clearInterval(timer)
  }, [])

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

  const messages = results as unknown as EnrichedMessage[]
  const newestId = messages[0]?._id
  const oldestId = messages[messages.length - 1]?._id
  // results[0] = mensagem mais nova (order desc do backend) — inverte pra
  // renderização top-to-bottom natural de chat. Mensagem nova sempre entra em
  // results[0] (vira o FIM da lista invertida); histórico antigo sempre entra no
  // fim de results (vira o INÍCIO da lista invertida) — ver 05-RESEARCH.md §3.
  const ordered = [...messages].reverse()

  // O ScrollArea da Radix não expõe o viewport real (overflow-y:auto) por prop —
  // resolve via querySelector do data-slot, sem editar o primitivo compartilhado
  // (05-RESEARCH.md §4). Roda a cada render e ANTES dos efeitos do useChatScroll
  // (ordem de declaração), porque o viewport só existe depois que "Carregando..." sai.
  useLayoutEffect(() => {
    viewportRef.current =
      containerRef.current?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]') ??
      null
  })

  const { isViewingOld, scrollToBottom } = useChatScroll({
    viewportRef,
    newestId,
    oldestId,
    canLoadMore: status === 'CanLoadMore',
    loadMore: () => loadMore(PAGE_SIZE),
    onReachBottom: () => {
      openChannel({ channelId }).catch(() => {})
    },
    ready: dividerMessageId !== undefined,
    initialScroll: (viewport) => {
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
    }
  })

  const timeline = buildTimeline(ordered, {
    getId: (m) => m._id,
    getAuthorId: (m) => m.author?.userId ?? null,
    getCreatedAt: (m) => m.createdAt,
    unreadMessageId: dividerMessageId
  })

  if (status === 'LoadingFirstPage') {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Carregando mensagens...
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative h-full">
      <ScrollArea className="h-full">
        <div className="flex flex-col pb-4">
          {status === 'Exhausted' && channelName ? (
            <ChannelWelcome
              title={`Boas-vindas a #${channelName}!`}
              subtitle={`Este é o começo do canal #${channelName}.`}
              icon={<Hash className="size-10" aria-hidden="true" />}
            />
          ) : null}
          {timeline.map((item) => {
            if (item.kind === 'day') return <DaySeparator key={item.key} label={item.label} />
            if (item.kind === 'unread') return <UnreadDivider key={item.key} />
            const { message } = item
            const name = message.author
              ? displayNameOf({
                  nickname: nicknameByUserId.get(message.author.userId),
                  displayName: message.author.displayName,
                  username: message.author.username
                })
              : 'Usuário desconhecido'
            return (
              <MessageRowView
                key={item.key}
                authorId={message.author?.userId ?? null}
                authorName={name}
                avatarUrl={message.author?.avatarUrl}
                createdAt={message.createdAt}
                now={now}
                isGroupStart={item.isGroupStart}
              >
                <MessageContent message={message} />
              </MessageRowView>
            )
          })}
        </div>
      </ScrollArea>

      {isViewingOld && (
        <div className="absolute inset-x-4 bottom-0">
          <JumpToPresentBar onJump={scrollToBottom} />
        </div>
      )}
    </div>
  )
}
