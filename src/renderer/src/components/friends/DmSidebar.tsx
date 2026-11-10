import { useQuery } from 'convex/react'
import { Users } from 'lucide-react'

import { UserAvatar } from '@/components/shell/UserAvatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { displayNameOf } from '@/lib/display-name'
import { cn } from '@/lib/utils'
import { useSelection } from '@/state/selection-context'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

// Sidebar da visão Início (plano 06-07): "Amigos" fixo no topo
// (selectedDmChannelId === null) e, abaixo, as conversas diretas.
export function DmSidebar(): React.JSX.Element {
  const { selectedDmChannelId, setSelectedDmChannelId } = useSelection()
  const dmChannels = useQuery(api.dms.listMyDmChannels)

  return (
    <div className="h-full flex flex-col [--avatar-ring:var(--sidebar)]">
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-2 pt-3 pb-[calc(var(--user-area-height,0px)+16px)]">
          <button
            type="button"
            onClick={() => setSelectedDmChannelId(null)}
            className={cn(
              'flex h-11 w-full items-center gap-3 rounded-md px-2 text-left text-base font-medium transition-colors',
              selectedDmChannelId === null
                ? 'bg-secondary text-strong'
                : 'text-muted-foreground hover:bg-sidebar-accent hover:text-strong'
            )}
          >
            <Users className="size-6 shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate">Amigos</span>
          </button>

          <h3 className="px-2 pt-4 pb-1 text-sm font-medium text-muted-foreground">
            Mensagens diretas
          </h3>

          {/* dmChannels === undefined enquanto a subscription não resolve —
              não renderiza nada para evitar "piscar" um estado vazio. */}
          {dmChannels ? (
            <div className="flex flex-col gap-0.5">
              {dmChannels.map((channel) => (
                <DmChannelRow
                  key={channel.dmChannelId}
                  otherUser={channel.otherUser}
                  isSelected={channel.dmChannelId === selectedDmChannelId}
                  onClick={() => setSelectedDmChannelId(channel.dmChannelId)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}

function DmChannelRow({
  otherUser,
  isSelected,
  onClick
}: {
  otherUser: {
    userId: Id<'users'>
    username: string
    displayName: string
    avatarUrl?: string
    online: boolean
  } | null
  isSelected: boolean
  onClick: () => void
}): React.JSX.Element {
  const name = otherUser ? displayNameOf(otherUser) : 'Usuário desconhecido'

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-11 items-center gap-3 rounded-md px-2 text-left transition-colors',
        isSelected
          ? 'bg-secondary text-strong'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-strong'
      )}
    >
      <UserAvatar
        userId={otherUser?.userId ?? 'desconhecido'}
        avatarUrl={otherUser?.avatarUrl}
        name={name}
        size={32}
        status={otherUser ? (otherUser.online ? 'online' : 'offline') : undefined}
      />
      <span className="min-w-0 flex-1 truncate text-base font-medium" title={name}>
        {name}
      </span>
    </button>
  )
}
