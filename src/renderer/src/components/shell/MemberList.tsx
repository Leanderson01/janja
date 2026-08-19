import { MicOff } from 'lucide-react'
import { useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'

import { Avatar, AvatarBadge, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useSelection } from '@/state/selection-context'
import { useVoice } from '@/state/voice-context'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

// Lista de membros do servidor selecionado (substitui o stub do Plano
// 03-01, depois orientado a `mockMembers` no próprio Plano 03-xx). A partir
// do Plano 04-07 a fonte é `convex/members.ts:listServerMembers`, que já
// resolve participação real + presença real (heartbeat, Fase 2) — "online"
// nunca é recomputado aqui, só consumido como veio da query. Agrupa por
// status online/offline (SRV-07/APP-02).

type ServerMember = FunctionReturnType<typeof api.members.listServerMembers>[number]
type VoiceParticipant = FunctionReturnType<typeof api.voice.voiceParticipantsByServer>[number]

// Overlay de fala/mute (anel verde + ícone de mute): desde o Plano 07-04,
// `muted` vem sempre de `voiceStates` real (via `voiceParticipantsByServer`)
// — presente para todo membro em qualquer canal de voz do servidor, esteja
// o usuário local conectado junto ou não. `speaking` só é significativo
// quando o membro está no MESMO canal ao qual o `Room` local está
// conectado (`joinedVoiceChannelId`) — fora disso não há como saber quem
// fala agora, dado 100% efêmero do LiveKit (ver `voiceStateFor` abaixo).
type VoiceState = { speaking: boolean; muted: boolean }

function neutralVoiceState(): VoiceState {
  return { speaking: false, muted: false }
}

/** Resolve o `VoiceState` de um membro a partir da linha de `voiceStates`
 * enriquecida (se houver — a maioria dos membros não está em call nenhuma)
 * e do conjunto de quem fala agora no canal ao qual o usuário local está
 * conectado. Combina as duas condições explicitamente — nunca assume que
 * `speakingUserIds.has(...)` sozinho já implica "no canal certo". */
function voiceStateFor(
  member: ServerMember,
  voiceStateByUserId: Map<Id<'users'>, VoiceParticipant>,
  joinedVoiceChannelId: Id<'channels'> | null,
  speakingUserIds: Set<string>
): VoiceState {
  const participant = voiceStateByUserId.get(member.userId)
  if (!participant) return neutralVoiceState()

  const speaking =
    participant.channelId === joinedVoiceChannelId && speakingUserIds.has(member.userId)

  return { speaking, muted: participant.muted }
}

function initialsFor(username: string): string {
  return username.slice(0, 2).toUpperCase()
}

function MemberAvatar({
  member,
  voiceState
}: {
  member: ServerMember
  voiceState: VoiceState
}): React.JSX.Element {
  // Um membro mutado nunca deveria estar "falando" ao mesmo tempo — se os
  // dados tiverem essa combinação inconsistente, o ícone de mute tem
  // prioridade visual e o anel de falando é omitido.
  const showSpeakingRing = voiceState.speaking && !voiceState.muted

  return (
    <div className="relative shrink-0">
      <Avatar className={showSpeakingRing ? 'ring-2 ring-green-500' : undefined}>
        <AvatarFallback>{initialsFor(member.username)}</AvatarFallback>
      </Avatar>
      <AvatarBadge
        className={member.online ? 'bg-green-500' : 'bg-muted-foreground'}
        aria-label={member.online ? 'online' : 'offline'}
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
  member: ServerMember
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
  voiceStateByUserId,
  joinedVoiceChannelId,
  speakingUserIds,
  dimmed = false
}: {
  title: string
  members: ServerMember[]
  voiceStateByUserId: Map<Id<'users'>, VoiceParticipant>
  joinedVoiceChannelId: Id<'channels'> | null
  speakingUserIds: Set<string>
  dimmed?: boolean
}): React.JSX.Element {
  return (
    <div className={dimmed ? 'opacity-60' : undefined}>
      <h3 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-col gap-0.5">
        {members.map((member) => (
          <MemberRow
            key={member.userId}
            member={member}
            voiceState={voiceStateFor(
              member,
              voiceStateByUserId,
              joinedVoiceChannelId,
              speakingUserIds
            )}
          />
        ))}
      </div>
    </div>
  )
}

export function MemberList(): React.JSX.Element {
  const { selectedServerId, joinedVoiceChannelId } = useSelection()
  const { speakingUserIds } = useVoice()

  const members = useQuery(
    api.members.listServerMembers,
    selectedServerId ? { serverId: selectedServerId } : 'skip'
  )
  const voiceParticipants = useQuery(
    api.voice.voiceParticipantsByServer,
    selectedServerId ? { serverId: selectedServerId } : 'skip'
  )
  const voiceStateByUserId = new Map((voiceParticipants ?? []).map((p) => [p.userId, p]))

  const onlineMembers = members?.filter((member) => member.online) ?? []
  const offlineMembers = members?.filter((member) => !member.online) ?? []

  return (
    <div className="h-full">
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-4 p-3">
          {onlineMembers.length > 0 ? (
            <MemberGroup
              title={`ONLINE — ${onlineMembers.length}`}
              members={onlineMembers}
              voiceStateByUserId={voiceStateByUserId}
              joinedVoiceChannelId={joinedVoiceChannelId}
              speakingUserIds={speakingUserIds}
            />
          ) : null}
          {offlineMembers.length > 0 ? (
            <MemberGroup
              title={`OFFLINE — ${offlineMembers.length}`}
              members={offlineMembers}
              voiceStateByUserId={voiceStateByUserId}
              joinedVoiceChannelId={joinedVoiceChannelId}
              speakingUserIds={speakingUserIds}
              dimmed
            />
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}
