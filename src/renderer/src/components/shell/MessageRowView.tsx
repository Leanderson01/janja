import type { ReactNode } from 'react'

import { UserAvatar } from '@/components/shell/UserAvatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatFullTimestamp, formatMessageTimestamp, formatShortTime } from '@/lib/message-time'

/** Linha de texto da mensagem. URL gigante quebra (`break-words`) em vez de estourar a coluna. */
export function MessageText({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div
      data-message-content
      className="whitespace-pre-wrap break-words text-base leading-[1.375rem] text-foreground"
    >
      {children}
    </div>
  )
}

/**
 * Linha de mensagem no estilo Discord. Início de grupo: foto, nome e horário. Continuação: só o
 * conteúdo, com a hora curta na margem ao passar o mouse. `children` é o conteúdo: uma string vira
 * `MessageText` (vazia não renderiza nada); outro nó é renderizado como está, e o chamador usa
 * `MessageText` para o texto dentro dele.
 */
export function MessageRowView({
  authorId,
  authorName,
  avatarUrl,
  createdAt,
  now,
  isGroupStart,
  children
}: {
  authorId: string | null
  authorName: string
  avatarUrl?: string | null
  createdAt: number
  now: number
  isGroupStart: boolean
  children: ReactNode
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'group relative py-0.5 pl-[72px] pr-12 hover:bg-accent',
        isGroupStart && 'mt-4'
      )}
    >
      {isGroupStart ? (
        <>
          <UserAvatar
            userId={authorId ?? 'desconhecido'}
            avatarUrl={avatarUrl}
            name={authorName}
            size={40}
            className="absolute left-4 top-1"
          />
          <div className="flex items-baseline gap-2">
            <span className="text-base font-medium text-strong">{authorName}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-muted-foreground">
                  {formatMessageTimestamp(createdAt, now)}
                </span>
              </TooltipTrigger>
              <TooltipContent>{formatFullTimestamp(createdAt)}</TooltipContent>
            </Tooltip>
          </div>
        </>
      ) : (
        <span className="absolute left-0 top-1 w-[72px] select-none pr-2 text-right text-[11px] leading-[1.375rem] text-muted-foreground opacity-0 group-hover:opacity-100">
          {formatShortTime(createdAt)}
        </span>
      )}
      {typeof children === 'string' ? (
        children.length > 0 ? (
          <MessageText>{children}</MessageText>
        ) : null
      ) : (
        children
      )}
    </div>
  )
}
