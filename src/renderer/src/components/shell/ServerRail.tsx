import { useState } from 'react'
import { useQuery } from 'convex/react'
import { Plus, Volume2 } from 'lucide-react'

import { HydraMark } from '@/components/brand/HydraMark'
import { CreateChannelDialog } from '@/components/shell/CreateChannelDialog'
import { CreateOrJoinServerDialog } from '@/components/shell/CreateOrJoinServerDialog'
import { InviteDialog } from '@/components/shell/InviteDialog'
import { ServerMenu } from '@/components/shell/ChannelSidebar'
import { initialsFor } from '@/components/shell/ParticipantStrip'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useSelection } from '@/state/selection-context'

import { api } from '../../../../../convex/_generated/api'
import type { Doc, Id } from '../../../../../convex/_generated/dataModel'

// Pílula à esquerda (estilo Discord): `idle` some (h-0), `unread` h-2 (sem uso
// até a rodada 2), `active` h-10; no hover do ícone vira h-5.
function RailPill({ state }: { state: 'idle' | 'unread' | 'active' }): React.JSX.Element {
  return (
    <span
      data-testid="rail-pill"
      data-state={state}
      aria-hidden="true"
      className={cn(
        'absolute left-0 w-1 rounded-r bg-strong transition-[height] duration-150',
        state === 'active' && 'h-10',
        state === 'unread' && 'h-2 group-hover/rail:h-5',
        state === 'idle' && 'h-0 group-hover/rail:h-5'
      )}
    />
  )
}

// Ícone de servidor: presentacional (sem Convex nem contextos) para poder ser
// testado sozinho. O menu de clique direito é colocado em volta por quem usa.
export function ServerRailIcon({
  name,
  iconUrl,
  isActive,
  hasUnread = false,
  inVoice,
  onSelect
}: {
  name: string
  iconUrl?: string | null
  isActive: boolean
  hasUnread?: boolean
  inVoice: boolean
  onSelect: () => void
}): React.JSX.Element {
  const state = isActive ? 'active' : hasUnread ? 'unread' : 'idle'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="group/rail relative flex h-10 w-full items-center justify-center">
          <RailPill state={state} />
          <button
            type="button"
            onClick={onSelect}
            aria-label={name}
            aria-current={isActive ? 'true' : undefined}
            className="relative flex size-10 items-center justify-center rounded-xl"
          >
            <Avatar className="size-10 rounded-xl">
              {iconUrl ? <AvatarImage src={iconUrl} alt={name} /> : null}
              <AvatarFallback className="rounded-xl bg-sidebar-border font-semibold text-strong">
                {initialsFor(name)}
              </AvatarFallback>
            </Avatar>
            {inVoice ? (
              <span
                role="img"
                aria-label="Você está em call neste servidor"
                className="absolute -top-1 -right-1 flex size-[18px] items-center justify-center rounded-full bg-success text-primary-foreground ring-2 ring-sidebar"
              >
                <Volume2 className="size-[11px]" aria-hidden="true" />
              </span>
            ) : null}
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">{name}</TooltipContent>
    </Tooltip>
  )
}

function HomeButton(): React.JSX.Element {
  const { view, goHome } = useSelection()
  const isActive = view === 'home'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="group/rail relative flex h-10 w-full items-center justify-center">
          <RailPill state={isActive ? 'active' : 'idle'} />
          <button
            type="button"
            onClick={() => goHome()}
            aria-label="Início"
            aria-current={isActive ? 'true' : undefined}
            className={cn(
              'flex size-10 items-center justify-center rounded-xl text-strong transition-colors',
              isActive ? 'bg-primary text-primary-foreground' : 'bg-sidebar-border hover:bg-primary'
            )}
          >
            <HydraMark className="size-6" />
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">Início</TooltipContent>
    </Tooltip>
  )
}

function AddServerButton(): React.JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Criar ou entrar num servidor"
            onClick={() => setDialogOpen(true)}
            className="flex size-10 items-center justify-center rounded-xl bg-sidebar-border text-success transition-colors hover:bg-success hover:text-primary-foreground"
          >
            <Plus className="size-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Adicionar servidor</TooltipContent>
      </Tooltip>
      <CreateOrJoinServerDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}

export function ServerRail(): React.JSX.Element {
  const { servers, view, selectedServerId, setSelectedServerId, joinedVoiceChannelId } =
    useSelection()
  // Servidor da call atual (pode ser diferente do aberto). Mesmo `getChannel`
  // do `VoiceConnectedSection`.
  const callServerId = useQuery(
    api.channels.getChannel,
    joinedVoiceChannelId ? { channelId: joinedVoiceChannelId } : 'skip'
  )?.serverId
  // Um único par de diálogos, para o servidor em que se clicou com o botão
  // direito (montá-los por ícone abriria 2 subscriptions por servidor).
  const [inviteServerId, setInviteServerId] = useState<Id<'servers'> | null>(null)
  const [createChannelServerId, setCreateChannelServerId] = useState<Id<'servers'> | null>(null)

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col items-center gap-2 pt-3 pb-[calc(var(--user-area-height,0px)+16px)]">
        <HomeButton />
        <div className="h-px w-8 bg-sidebar-border" aria-hidden="true" />
        {/* servers === undefined enquanto a subscription inicial não resolve — não
            travamos em spinner, só não desenhamos ícone nenhum até chegar dado real
            (ou lista vazia, que também não desenha ícone nenhum). */}
        {servers?.map((server: Doc<'servers'>) => (
          <ServerMenu
            key={server._id}
            serverName={server.name}
            onInvite={() => setInviteServerId(server._id)}
            onCreateChannel={() => setCreateChannelServerId(server._id)}
          >
            <ServerRailIcon
              name={server.name}
              iconUrl={server.iconUrl}
              isActive={view === 'server' && server._id === selectedServerId}
              inVoice={server._id === callServerId}
              onSelect={() => setSelectedServerId(server._id)}
            />
          </ServerMenu>
        ))}
        <AddServerButton />
      </div>
      {inviteServerId ? (
        <InviteDialog
          serverId={inviteServerId}
          open
          onOpenChange={(open) => !open && setInviteServerId(null)}
        />
      ) : null}
      {createChannelServerId ? (
        <CreateChannelDialog
          serverId={createChannelServerId}
          open
          onOpenChange={(open) => !open && setCreateChannelServerId(null)}
        />
      ) : null}
    </ScrollArea>
  )
}
