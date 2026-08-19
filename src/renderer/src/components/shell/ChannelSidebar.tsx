import { Fragment } from 'react'
import { Hash, MicOff, Volume2 } from 'lucide-react'

import { VoiceControlBar } from '@/components/shell/VoiceControlBar'
import { UserPanel } from '@/features/auth/UserPanel'
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { mockChannels, mockMembers, mockVoiceParticipants, type Channel } from '@/data/mock-data'
import { cn } from '@/lib/utils'
import { useSelection } from '@/state/selection-context'

import type { Id } from '../../../../../convex/_generated/dataModel'

// Sidebar de canais (Plano 03-02) — substitui o stub do Plano 03-01. Lê
// `mockChannels`/`mockMembers`/`mockVoiceParticipants` de mock-data.ts (não
// duplica fixtures) e `useSelection()` para navegação de canal de
// texto/join-leave de canal de voz. `VoiceControlBar` (mesmo plano) fica
// como rodapé fixo, fora da área rolável.
//
// A partir do plano 04-05, `selectedServerId`/`selectedChannelId` do
// SelectionProvider são ids reais do Convex — nunca vão bater com os ids
// mockados abaixo, então este componente passa a renderizar "sem canais"
// até o plano 04-06 trocar `mockChannels` por `api.channels.listChannels`.
// Isso é esperado (estado vazio, não crash), não uma regressão deste plano.
export function ChannelSidebar(): React.JSX.Element {
  const {
    selectedServerId,
    selectedChannelId,
    setSelectedChannelId,
    joinedVoiceChannelId,
    setJoinedVoiceChannelId
  } = useSelection()

  const channels = mockChannels.filter((channel) => channel.serverId === selectedServerId)

  const categories: string[] = []
  for (const channel of channels) {
    if (!categories.includes(channel.category)) {
      categories.push(channel.category)
    }
  }

  // Cast temporário: `channel.id` é um id mockado (string solta), não o
  // `Id<'channels'>` real que o contexto de seleção exige a partir deste
  // plano. Removido pelo plano 04-06 quando este componente passar a
  // iterar sobre `Doc<'channels'>` de verdade.
  function handleTextChannelClick(channel: Channel): void {
    setSelectedChannelId(channel.id as Id<'channels'>)
  }

  function handleVoiceChannelClick(channel: Channel): void {
    const channelId = channel.id as Id<'channels'>
    setSelectedChannelId(channelId)
    setJoinedVoiceChannelId(joinedVoiceChannelId === channelId ? null : channelId)
  }

  return (
    <div className="h-full flex flex-col">
      <ScrollArea className="flex-1 min-h-0">
        <div className="py-3">
          {categories.map((category, index) => {
            const channelsInCategory = channels.filter((channel) => channel.category === category)

            return (
              <Fragment key={category}>
                {index > 0 && <Separator className="my-2" />}
                <div className="px-3 pb-1 text-xs font-semibold uppercase text-muted-foreground">
                  {category}
                </div>
                <div className="flex flex-col gap-0.5 px-2">
                  {channelsInCategory.map((channel) =>
                    channel.type === 'text' ? (
                      <TextChannelRow
                        key={channel.id}
                        channel={channel}
                        isSelected={channel.id === selectedChannelId}
                        onClick={() => handleTextChannelClick(channel)}
                      />
                    ) : (
                      <VoiceChannelRow
                        key={channel.id}
                        channel={channel}
                        isSelected={channel.id === selectedChannelId}
                        isJoined={channel.id === joinedVoiceChannelId}
                        onClick={() => handleVoiceChannelClick(channel)}
                      />
                    )
                  )}
                </div>
              </Fragment>
            )
          })}
        </div>
      </ScrollArea>

      <VoiceControlBar />
      <UserPanel />
    </div>
  )
}

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

function TextChannelRow({
  channel,
  isSelected,
  onClick
}: {
  channel: Channel
  isSelected: boolean
  onClick: () => void
}): React.JSX.Element {
  const hasUnread = channel.unreadCount > 0

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors',
        isSelected
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
        hasUnread && !isSelected && 'text-foreground font-semibold'
      )}
    >
      <Hash className="size-4 shrink-0" />
      <span className="flex-1 truncate">{channel.name}</span>
      {hasUnread && (
        <Badge variant="secondary" className="shrink-0">
          {channel.unreadCount}
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
  channel: Channel
  isSelected: boolean
  isJoined: boolean
  onClick: () => void
}): React.JSX.Element {
  const participants = mockVoiceParticipants.filter((p) => p.channelId === channel.id)

  return (
    <div className="flex flex-col gap-1">
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

      {participants.length > 0 && (
        <div className="flex flex-col gap-1.5 pb-1 pl-8">
          {participants.map((participant) => {
            const member = mockMembers.find((m) => m.id === participant.memberId)
            if (!member) {
              return null
            }

            return (
              <div
                key={participant.memberId}
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <Avatar size="sm" className={cn(participant.speaking && 'ring-2 ring-green-500')}>
                  <AvatarImage src={member.avatarUrl} alt={member.username} />
                  <AvatarFallback>{initials(member.username)}</AvatarFallback>
                  {participant.muted && (
                    <AvatarBadge className="bg-destructive size-3">
                      <MicOff />
                    </AvatarBadge>
                  )}
                </Avatar>
                <span className="truncate">{member.username}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
