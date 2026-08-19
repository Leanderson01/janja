import { useState } from 'react'
import { useQuery } from 'convex/react'
import { Hash, Plus, UserPlus, Volume2 } from 'lucide-react'

import { CreateChannelDialog } from '@/components/shell/CreateChannelDialog'
import { InviteDialog } from '@/components/shell/InviteDialog'
import { VoiceControlBar } from '@/components/shell/VoiceControlBar'
import { UserPanel } from '@/features/auth/UserPanel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useSelection } from '@/state/selection-context'

import { api } from '../../../../../convex/_generated/api'
import type { Doc } from '../../../../../convex/_generated/dataModel'

// Sidebar de canais (Plano 03-02) — a partir do plano 04-06 lê canais reais
// via `api.channels.listChannels` em vez de `mock-data.ts`. `VoiceControlBar`
// (mesmo plano da Fase 3) segue como rodapé fixo, fora da área rolável.
//
// Agrupamento fixo em duas seções (TEXTO/VOZ) — o modelo real de canal desta
// fase não tem `category` (era um campo só do mock). Badge de não lidas por
// canal (CHAT-06, plano 05-04) alimentado por `getUnreadCounts` — só canais
// de texto ganham badge, a query já filtra canal de voz. Lista de
// participantes de voz aninhados sob o canal segue fora de escopo (F7):
// `voiceStates` não existe no backend ainda.
export function ChannelSidebar(): React.JSX.Element {
  const {
    servers,
    selectedServerId,
    selectedChannelId,
    setSelectedChannelId,
    joinedVoiceChannelId,
    setJoinedVoiceChannelId
  } = useSelection()

  const [inviteOpen, setInviteOpen] = useState(false)
  const [createChannelOpen, setCreateChannelOpen] = useState(false)

  const channels = useQuery(
    api.channels.listChannels,
    selectedServerId ? { serverId: selectedServerId } : 'skip'
  )
  const unreadCounts = useQuery(
    api.channelReadState.getUnreadCounts,
    selectedServerId ? { serverId: selectedServerId } : 'skip'
  )
  const unreadByChannel = new Map((unreadCounts ?? []).map((u) => [u.channelId, u.unreadCount]))

  function handleTextChannelClick(channel: Doc<'channels'>): void {
    setSelectedChannelId(channel._id)
  }

  function handleVoiceChannelClick(channel: Doc<'channels'>): void {
    setSelectedChannelId(channel._id)
    setJoinedVoiceChannelId(joinedVoiceChannelId === channel._id ? null : channel._id)
  }

  // Zero servidores (estado possível vindo do plano 04-05): não há
  // `serverId` para passar a `listChannels`, então nem tentamos — só um
  // estado vazio simples.
  if (selectedServerId === null) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 min-h-0 flex items-center justify-center px-4 text-center text-sm text-muted-foreground">
          Crie ou entre em um servidor para começar
        </div>
        <VoiceControlBar />
        <UserPanel />
      </div>
    )
  }

  const selectedServer = servers?.find((s) => s._id === selectedServerId)
  const textChannels = channels?.filter((channel) => channel.type === 'text') ?? []
  const voiceChannels = channels?.filter((channel) => channel.type === 'voice') ?? []

  return (
    <div className="h-full flex flex-col">
      <div className="h-12 flex-none flex items-center justify-between px-3 border-b border-border">
        <span className="font-semibold text-foreground truncate">{selectedServer?.name}</span>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Convidar"
                onClick={() => setInviteOpen(true)}
              >
                <UserPlus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Convidar</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Criar canal"
                onClick={() => setCreateChannelOpen(true)}
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Criar canal</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="py-3">
          {/* channels === undefined enquanto a subscription não resolve — não é
              erro, é carregamento; mantemos a estrutura sem itens até chegar
              dado real. */}
          {textChannels.length > 0 && (
            <>
              <div className="px-3 pb-1 text-xs font-semibold uppercase text-muted-foreground">
                TEXTO
              </div>
              <div className="flex flex-col gap-0.5 px-2">
                {textChannels.map((channel) => (
                  <TextChannelRow
                    key={channel._id}
                    channel={channel}
                    isSelected={channel._id === selectedChannelId}
                    unreadCount={unreadByChannel.get(channel._id) ?? 0}
                    onClick={() => handleTextChannelClick(channel)}
                  />
                ))}
              </div>
            </>
          )}

          {textChannels.length > 0 && voiceChannels.length > 0 && <Separator className="my-2" />}

          {voiceChannels.length > 0 && (
            <>
              <div className="px-3 pb-1 text-xs font-semibold uppercase text-muted-foreground">
                VOZ
              </div>
              <div className="flex flex-col gap-0.5 px-2">
                {voiceChannels.map((channel) => (
                  <VoiceChannelRow
                    key={channel._id}
                    channel={channel}
                    isSelected={channel._id === selectedChannelId}
                    isJoined={channel._id === joinedVoiceChannelId}
                    onClick={() => handleVoiceChannelClick(channel)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      <VoiceControlBar />
      <UserPanel />

      <InviteDialog serverId={selectedServerId} open={inviteOpen} onOpenChange={setInviteOpen} />
      <CreateChannelDialog
        serverId={selectedServerId}
        open={createChannelOpen}
        onOpenChange={setCreateChannelOpen}
      />
    </div>
  )
}

function TextChannelRow({
  channel,
  isSelected,
  unreadCount,
  onClick
}: {
  channel: Doc<'channels'>
  isSelected: boolean
  unreadCount: number
  onClick: () => void
}): React.JSX.Element {
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
      <Hash className="size-4 shrink-0" />
      <span className="flex-1 truncate">{channel.name}</span>
      {unreadCount > 0 && (
        <Badge variant="secondary" className="shrink-0">
          {unreadCount}
        </Badge>
      )}
    </button>
  )
}

function VoiceChannelRow({
  channel,
  isSelected,
  isJoined,
  onClick
}: {
  channel: Doc<'channels'>
  isSelected: boolean
  isJoined: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors',
        isSelected
          ? 'bg-accent text-accent-foreground'
          : isJoined
            ? 'text-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
      )}
    >
      <Volume2 className="size-4 shrink-0" />
      <span className="flex-1 truncate">{channel.name}</span>
    </button>
  )
  // Lista de participantes de voz aninhada sob o canal (avatares, anel de
  // fala, ícone de mute) é F7: depende de `voiceStates` real, que não existe
  // no backend desta fase.
}
