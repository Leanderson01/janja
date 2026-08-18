import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { mockMembers, type Message } from '@/data/mock-data'

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit'
})

function initialsFor(username: string): string {
  return username.slice(0, 2).toUpperCase()
}

// Divisor "novas mensagens" (CHAT-05, antecipado nesta fase) — linha
// horizontal com rótulo centralizado em cor de destaque, imediatamente
// antes da mensagem marcada como `firstUnreadMessageId` do canal.
function UnreadDivider(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 py-1" role="separator" aria-label="Novas mensagens">
      <Separator className="flex-1 bg-red-500" />
      <span className="text-xs font-semibold text-red-500 whitespace-nowrap">NOVAS MENSAGENS</span>
      <Separator className="flex-1 bg-red-500" />
    </div>
  )
}

function MessageRow({ message }: { message: Message }): React.JSX.Element {
  const author = mockMembers.find((m) => m.id === message.authorId)
  // Mensagens de eco local (Task 3 do Plano 03-03) usam `authorId: 'me'`,
  // que não existe em `mockMembers` — tratado aqui como o usuário atual.
  const isLocalEcho = message.authorId === 'me'
  const displayName = isLocalEcho
    ? 'Você'
    : author
      ? `${author.username}#${author.tag}`
      : 'Usuário desconhecido'
  const initials = isLocalEcho ? 'EU' : initialsFor(author?.username ?? '??')

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

type MessageListProps = {
  messages: Message[]
  firstUnreadMessageId?: string
}

// Lista rolável de mensagens (RESEARCH.md §3: `flex-1 min-h-0` no wrapper do
// pai + `overflow-y-auto` aqui, via ScrollArea). Espera receber `messages`
// já filtradas por canal e ordenadas por `createdAt` pelo componente pai.
export function MessageList({
  messages,
  firstUnreadMessageId
}: MessageListProps): React.JSX.Element {
  if (messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Nenhuma mensagem ainda
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col py-2">
        {messages.map((message) => (
          <div key={message.id}>
            {message.id === firstUnreadMessageId ? <UnreadDivider /> : null}
            <MessageRow message={message} />
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
