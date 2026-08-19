import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'

import type { Id } from '../../../../../convex/_generated/dataModel'

// Lista de mensagens de uma conversa direta (plano 06-07) — mesmo estilo
// visual de MessageList.tsx (Fase 3), mas sem UnreadDivider (fora de escopo
// de SOCIAL-05) e sem depender de mockMembers: numa DM só existem 2
// participantes possíveis (eu e otherUser), então "é minha mensagem" é
// simplesmente `authorId !== otherUser.userId` (06-RESEARCH.md, nota no
// <context> do plano).
const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit'
})

function initialsFor(username: string): string {
  return username.slice(0, 2).toUpperCase()
}

type DmMessage = {
  _id: Id<'dmMessages'>
  authorId: Id<'users'>
  content: string
  createdAt: number
}

type OtherUser = {
  userId: Id<'users'>
  username: string
  tag: string
}

function DmMessageRow({
  message,
  otherUser
}: {
  message: DmMessage
  otherUser: OtherUser
}): React.JSX.Element {
  const isMine = message.authorId !== otherUser.userId
  const displayName = isMine ? 'Você' : `${otherUser.username}#${otherUser.tag}`
  const initials = isMine ? 'EU' : initialsFor(otherUser.username)

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

type DmMessageListProps = {
  messages: DmMessage[]
  otherUser: OtherUser
}

// Espera receber `messages` já em ordem crescente (mais antiga primeiro) e
// invertida pelo componente pai — mesma convenção de MessageList.tsx. O
// backend (listDmMessages) devolve em ordem decrescente.
export function DmMessageList({ messages, otherUser }: DmMessageListProps): React.JSX.Element {
  if (messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Nenhuma mensagem ainda — diga oi!
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col py-2">
        {messages.map((message) => (
          <DmMessageRow key={message._id} message={message} otherUser={otherUser} />
        ))}
      </div>
    </ScrollArea>
  )
}
