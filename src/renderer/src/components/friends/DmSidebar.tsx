import { useQuery } from 'convex/react'
import { Users } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useSelection } from '@/state/selection-context'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

// Sidebar da visão Início (plano 06-07) — mesmo padrão visual de
// ChannelSidebar.tsx (ScrollArea + linhas com cn() para estado selecionado),
// mas navegando entre conversas diretas em vez de canais de servidor.
// "Amigos" é uma linha fixa no topo (selectedDmChannelId === null), sempre
// visível independente de o usuário já ter alguma conversa aberta.
function initialsFor(username: string): string {
  return username.slice(0, 2).toUpperCase()
}

export function DmSidebar(): React.JSX.Element {
  const { selectedDmChannelId, setSelectedDmChannelId } = useSelection()
  const dmChannels = useQuery(api.dms.listMyDmChannels)

  return (
    <div className="h-full flex flex-col">
      <ScrollArea className="flex-1 min-h-0">
        <div className="py-3 px-2">
          <button
            type="button"
            onClick={() => setSelectedDmChannelId(null)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors',
              selectedDmChannelId === null
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
            )}
          >
            <Users className="size-4 shrink-0" />
            <span className="flex-1 truncate">Amigos</span>
          </button>

          <Separator className="my-2" />

          {/* dmChannels === undefined enquanto a subscription não resolve —
              não renderiza nada abaixo do separador para evitar "piscar" um
              estado vazio antes do dado real chegar. Lista vazia (usuário
              sem nenhuma conversa aberta) também não mostra nada extra: é
              estado normal, não erro. */}
          {dmChannels ? (
            <div className="flex flex-col gap-0.5">
              {dmChannels.map((channel) => (
                <DmChannelRow
                  key={channel.dmChannelId}
                  dmChannelId={channel.dmChannelId}
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
  dmChannelId: Id<'dmChannels'>
  otherUser: {
    userId: Id<'users'>
    username: string
    tag: string
    avatarUrl?: string
  } | null
  isSelected: boolean
  onClick: () => void
}): React.JSX.Element {
  const label = otherUser ? `${otherUser.username}#${otherUser.tag}` : 'Usuário desconhecido'

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors',
        isSelected
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
      )}
    >
      <Avatar size="sm">
        {otherUser?.avatarUrl ? (
          <AvatarImage src={otherUser.avatarUrl} alt={otherUser.username} />
        ) : null}
        <AvatarFallback>{initialsFor(otherUser?.username ?? '??')}</AvatarFallback>
      </Avatar>
      <span className="flex-1 truncate">{label}</span>
    </button>
  )
}
