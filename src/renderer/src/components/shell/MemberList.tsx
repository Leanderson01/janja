import { MicOff, MonitorUp } from 'lucide-react'
import { useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'

import { Avatar, AvatarBadge, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useSelection } from '@/state/selection-context'
import { useVoice } from '@/state/voice-context'

import { MemberName } from './MemberName'
import { MemberSectionHeader } from './MemberSectionHeader'

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

// Overlay de fala/mute/compartilhamento (anel verde + ícones sobre o
// avatar): desde o Plano 07-04, `muted` vem sempre de `voiceStates` real
// (via `voiceParticipantsByServer`) — presente para todo membro em qualquer
// canal de voz do servidor, esteja o usuário local conectado junto ou não.
// `sharing` (SHARE-05, Plano 08-06) entra pela MESMA porta e pela mesma
// razão: é dado de aplicação, escrito no Convex pelo cliente que publica a
// track (Plano 08-05) e reconciliado por webhook quando esse cliente morre
// (Plano 08-01), então vale para quem está fora do canal — que é justamente
// quem precisa do ícone para saber que tem algo acontecendo lá dentro.
// `speaking` é o único dos três que só é significativo quando o membro está
// no MESMO canal ao qual o `Room` local está conectado
// (`joinedVoiceChannelId`) — fora disso não há como saber quem fala agora,
// dado 100% efêmero do LiveKit (ver `voiceStateFor` abaixo).
type VoiceState = { speaking: boolean; muted: boolean; sharing: boolean }

function neutralVoiceState(): VoiceState {
  return { speaking: false, muted: false, sharing: false }
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

  return { speaking, muted: participant.muted, sharing: participant.sharing }
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
      {/* SHARE-05: canto superior ESQUERDO, sozinho. Os outros dois cantos já
          têm dono (mute em cima à direita, presença online embaixo à direita,
          esta última vinda do `AvatarBadge` do design system) e empilhar dois
          ícones no mesmo canto tornaria os dois ilegíveis num avatar de 32px.
          Verde porque o estado é ativo/positivo, ao contrário do mute. */}
      {voiceState.sharing ? (
        <span
          className="absolute -left-1 -top-1 z-10 flex size-3.5 items-center justify-center rounded-full bg-background text-green-500 ring-1 ring-background"
          aria-label="compartilhando a tela"
        >
          <MonitorUp className="size-2.5" />
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
      <MemberName username={member.username} tag={member.tag} />
    </div>
  )
}

function MemberGroup({
  label,
  members,
  voiceStateByUserId,
  joinedVoiceChannelId,
  speakingUserIds,
  dimmed = false
}: {
  label: string
  members: ServerMember[]
  voiceStateByUserId: Map<Id<'users'>, VoiceParticipant>
  joinedVoiceChannelId: Id<'channels'> | null
  speakingUserIds: Set<string>
  dimmed?: boolean
}): React.JSX.Element {
  return (
    <div className={dimmed ? 'opacity-60' : undefined}>
      <MemberSectionHeader label={label} count={members.length} />
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
              label="ONLINE"
              members={onlineMembers}
              voiceStateByUserId={voiceStateByUserId}
              joinedVoiceChannelId={joinedVoiceChannelId}
              speakingUserIds={speakingUserIds}
            />
          ) : null}
          {offlineMembers.length > 0 ? (
            <MemberGroup
              label="OFFLINE"
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
