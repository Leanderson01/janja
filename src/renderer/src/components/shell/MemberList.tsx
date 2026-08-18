import { MicOff } from 'lucide-react'

import { Avatar, AvatarBadge, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { mockChannels, mockMembers, mockVoiceParticipants, type Member } from '@/data/mock-data'
import { useSelection } from '@/state/selection-context'

// Lista de membros do servidor selecionado (substitui o stub do Plano
// 03-01). Agrupa por status online/offline (antecipa APP-02/SRV-07) e
// sobrepõe o mesmo estado de voz (falando/mutado) usado na sidebar de
// canais (Plano 03-02), antecipando VOICE-06/VOICE-08 (F7) — o objetivo é
// que quando essas features "de verdade" chegarem, só troquem os dados
// mockados por dados reais, sem retrabalho de CSS/estrutura.

type VoiceState = { speaking: boolean; muted: boolean }

function initialsFor(username: string): string {
  return username.slice(0, 2).toUpperCase()
}

function MemberAvatar({
  member,
  voiceState
}: {
  member: Member
  voiceState: VoiceState
}): React.JSX.Element {
  // Um membro mutado nunca deveria estar "falando" ao mesmo tempo — se os
  // dados mockados tiverem essa combinação inconsistente, o ícone de mute
  // tem prioridade visual e o anel de falando é omitido (ver Task 2 do
  // plano).
  const showSpeakingRing = voiceState.speaking && !voiceState.muted

  return (
    <div className="relative shrink-0">
      <Avatar className={showSpeakingRing ? 'ring-2 ring-green-500' : undefined}>
        <AvatarFallback>{initialsFor(member.username)}</AvatarFallback>
      </Avatar>
      <AvatarBadge
        className={member.status === 'online' ? 'bg-green-500' : 'bg-muted-foreground'}
        aria-label={member.status === 'online' ? 'online' : 'offline'}
      />
      {voiceState.muted ? (
        <span
          className="absolute -right-1 -top-1 z-10 flex size-3.5 items-center justify-center rounded-full bg-background text-foreground ring-1 ring-background"
          aria-label="mutado"
        >
          <MicOff className="size-2.5" />
        </span>
      ) : null}
    </div>
  )
}

function MemberRow({
  member,
  voiceState
}: {
  member: Member
  voiceState: VoiceState
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/50">
      <MemberAvatar member={member} voiceState={voiceState} />
      <span className="truncate text-sm">
        {member.username}
        <span className="text-muted-foreground">#{member.tag}</span>
      </span>
    </div>
  )
}

function MemberGroup({
  title,
  members,
  voiceStateFor,
  dimmed = false
}: {
  title: string
  members: Member[]
  voiceStateFor: (memberId: string) => VoiceState
  dimmed?: boolean
}): React.JSX.Element {
  return (
    <div className={dimmed ? 'opacity-60' : undefined}>
      <h3 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-col gap-0.5">
        {members.map((member) => (
          <MemberRow key={member.id} member={member} voiceState={voiceStateFor(member.id)} />
        ))}
      </div>
    </div>
  )
}

export function MemberList(): React.JSX.Element {
  const { selectedServerId } = useSelection()

  const serverChannelIds = mockChannels
    .filter((channel) => channel.serverId === selectedServerId)
    .map((channel) => channel.id)

  const serverMembers = mockMembers.filter((member) => member.serverId === selectedServerId)
  const onlineMembers = serverMembers.filter((member) => member.status === 'online')
  const offlineMembers = serverMembers.filter((member) => member.status === 'offline')

  function voiceStateFor(memberId: string): VoiceState {
    // Um membro pode estar num canal de voz do servidor sem estar
    // necessariamente no canal de voz "selecionado" na sidebar — o overlay
    // aqui considera QUALQUER canal de voz do servidor (ver Task 2 do plano).
    const participant = mockVoiceParticipants.find(
      (p) => p.memberId === memberId && serverChannelIds.includes(p.channelId)
    )
    return { speaking: participant?.speaking ?? false, muted: participant?.muted ?? false }
  }

  return (
    <div className="h-full">
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-4 p-3">
          {onlineMembers.length > 0 ? (
            <MemberGroup
              title={`ONLINE — ${onlineMembers.length}`}
              members={onlineMembers}
              voiceStateFor={voiceStateFor}
            />
          ) : null}
          {offlineMembers.length > 0 ? (
            <MemberGroup
              title={`OFFLINE — ${offlineMembers.length}`}
              members={offlineMembers}
              voiceStateFor={voiceStateFor}
              dimmed
            />
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}
