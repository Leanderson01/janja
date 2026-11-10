import { Check, MessageCircle, X } from 'lucide-react'
import type { ReactNode } from 'react'

import { UserAvatar } from '@/components/shell/UserAvatar'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

function ActionButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick?(): void
  children: ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          className="rounded-full"
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Linha da lista de amigos no estilo Discord. As ações (Mensagem, menu "…") aparecem ao passar o
 * mouse ou com foco; pedidos recebidos mostram Aceitar/Recusar sempre. Pedido enviado só informa o
 * estado: não existe cancelar.
 */
export function FriendRowView({
  userId,
  displayName,
  username,
  avatarUrl,
  online,
  onMessage,
  menu,
  pending,
  onAccept,
  onReject
}: {
  userId: string
  displayName: string
  username: string
  avatarUrl?: string | null
  online: boolean
  onMessage?(): void
  menu?: ReactNode
  pending?: 'recebido' | 'enviado'
  onAccept?(): void
  onReject?(): void
}): React.JSX.Element {
  const status = pending
    ? pending === 'recebido'
      ? 'Pedido de amizade recebido'
      : 'Pedido de amizade enviado'
    : online
      ? 'Online'
      : 'Offline'

  return (
    <div className="group mx-5 flex h-[62px] items-center gap-3 rounded-lg border-t border-border px-2 hover:bg-accent hover:border-transparent [--avatar-ring:var(--background)] hover:[--avatar-ring:var(--accent)]">
      <UserAvatar
        userId={userId}
        avatarUrl={avatarUrl}
        name={displayName}
        size={32}
        status={pending ? undefined : online ? 'online' : 'offline'}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-base font-semibold text-strong" title={displayName}>
            {displayName}
          </span>
          <span className="truncate text-sm text-muted-foreground">{username}</span>
        </div>
        <span className="truncate text-sm text-muted-foreground">{status}</span>
      </div>
      {pending === 'recebido' ? (
        <div className="flex items-center gap-2">
          <ActionButton label="Aceitar" onClick={onAccept}>
            <Check className="text-success" />
          </ActionButton>
          <ActionButton label="Recusar" onClick={onReject}>
            <X className="text-destructive" />
          </ActionButton>
        </div>
      ) : pending ? null : (
        <div className="flex items-center gap-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {onMessage ? (
            <ActionButton label="Mensagem" onClick={onMessage}>
              <MessageCircle />
            </ActionButton>
          ) : null}
          {menu}
        </div>
      )}
    </div>
  )
}
