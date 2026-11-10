import { useLayoutEffect, useRef, useState, useEffect } from 'react'

import { ChannelWelcome, DaySeparator, JumpToPresentBar } from '@/components/shell/ChatChrome'
import { LinkPreviewCard } from '@/components/shell/LinkPreviewCard'
import { MessageRowView, MessageText } from '@/components/shell/MessageRowView'
import { UserAvatar } from '@/components/shell/UserAvatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useChatScroll } from '@/hooks/useChatScroll'
import { displayNameOf } from '@/lib/display-name'
import { shouldShowJumpBar } from '@/lib/jump-bar'
import { buildTimeline } from '@/lib/message-grouping'
import { linksOf } from '@/lib/message-links'

import type { Id } from '../../../../../convex/_generated/dataModel'

// Lista de mensagens de uma conversa direta, no mesmo estilo de MessageList.tsx (linha do Discord,
// grupos por autor, separador de dia, prévia de link, faixa "ir para o presente"). Numa DM só
// existem dois autores: `otherUser` e eu. Sem divisor de não lidas e sem anexos.
const NOW_TICK_MS = 60_000

type DmMessage = {
  _id: Id<'dmMessages'>
  authorId: Id<'users'>
  content: string
  createdAt: number
}

type Person = {
  userId: Id<'users'>
  username: string
  displayName: string
  avatarUrl?: string
}

type DmMessageListProps = {
  /** Ordem crescente (mais antiga primeiro). */
  messages: DmMessage[]
  otherUser: Person
  me: { username: string; displayName: string; avatarUrl?: string } | null
  canLoadMore: boolean
  loadMore(): void
  isExhausted: boolean
}

export function DmMessageList({
  messages,
  otherUser,
  me,
  canLoadMore,
  loadMore,
  isExhausted
}: DmMessageListProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), NOW_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  // O viewport real do ScrollArea só se resolve por data-slot (mesmo truque de MessageList).
  useLayoutEffect(() => {
    viewportRef.current =
      containerRef.current?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]') ??
      null
  })

  const { isViewingOld, newMessageCount, scrollToBottom } = useChatScroll({
    viewportRef,
    newestId: messages[messages.length - 1]?._id,
    oldestId: messages[0]?._id,
    canLoadMore,
    loadMore,
    initialScroll: (viewport) => {
      viewport.scrollTop = viewport.scrollHeight
    }
  })

  const timeline = buildTimeline(messages, {
    getId: (m) => m._id,
    getAuthorId: (m) => m.authorId,
    getCreatedAt: (m) => m.createdAt
  })

  const otherName = displayNameOf(otherUser)

  return (
    <div ref={containerRef} className="relative h-full">
      <ScrollArea className="h-full">
        <div className="flex flex-col pb-4">
          {isExhausted ? (
            <ChannelWelcome
              title={otherName}
              bareIcon
              subtitle={`Este é o começo do seu histórico de mensagens diretas com @${otherUser.username}.`}
              icon={
                <UserAvatar
                  userId={otherUser.userId}
                  avatarUrl={otherUser.avatarUrl}
                  name={otherName}
                  size={80}
                />
              }
            />
          ) : null}
          {timeline.map((item) => {
            if (item.kind === 'day') return <DaySeparator key={item.key} label={item.label} />
            if (item.kind === 'unread') return null
            const { message } = item
            const author = message.authorId === otherUser.userId ? otherUser : me
            const links = linksOf(message.content)
            return (
              <MessageRowView
                key={item.key}
                authorId={message.authorId}
                authorName={author ? displayNameOf(author) : 'Usuário desconhecido'}
                avatarUrl={author?.avatarUrl}
                createdAt={message.createdAt}
                now={now}
                isGroupStart={item.isGroupStart}
              >
                <>
                  <MessageText>{message.content}</MessageText>
                  {links.map((link) => (
                    <LinkPreviewCard key={link} url={link} />
                  ))}
                </>
              </MessageRowView>
            )
          })}
        </div>
      </ScrollArea>

      {shouldShowJumpBar({ isViewingOld, newMessageCount }) && (
        <div className="absolute inset-x-2 bottom-0">
          <JumpToPresentBar onJump={scrollToBottom} />
        </div>
      )}
    </div>
  )
}
