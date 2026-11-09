import { useState } from 'react'
import { Crown, MonitorUp, Volume2 } from 'lucide-react'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { toast } from 'sonner'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { displayNameOf } from '@/lib/display-name'
import { cn } from '@/lib/utils'
import { useSelection } from '@/state/selection-context'
import { useVoice } from '@/state/voice-context'
import { readableConvexError } from '@/lib/convex-error'

import { MemberName } from './MemberName'
import { ParticipantAudioMenuItems } from './ParticipantAudioMenu'
import { UserAvatar } from './UserAvatar'
import type { ParticipantAudioPreference } from '@/lib/participant-volumes'
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

// Overlay de fala/mute/compartilhamento (anel de `--success` + ícones sobre o
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
// `inVoice`: a pessoa está em algum canal de voz do servidor.
type VoiceState = { speaking: boolean; muted: boolean; sharing: boolean; inVoice: boolean }

function neutralVoiceState(): VoiceState {
  return { speaking: false, muted: false, sharing: false, inVoice: false }
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

  return { speaking, muted: participant.muted, sharing: participant.sharing, inVoice: true }
}

/** Assinatura mínima da mutation `friends.sendFriendRequest`. A linha recebe a
 * função por prop em vez de chamar `useMutation` ela mesma porque
 * `useMutation` exige estar sob um `ConvexProvider` — e a linha precisa ser
 * montável sozinha em teste (jsdom), sem levantar cliente do Convex junto.
 * Quem chama `useMutation` de verdade é `MemberList`, uma vez só. */
export type SendFriendRequest = (args: { username: string; tag: string }) => Promise<unknown>

export function MemberRow({
  member,
  voiceState,
  isOwner = false,
  sendFriendRequest,
  audio
}: {
  member: ServerMember
  voiceState: VoiceState
  isOwner?: boolean
  sendFriendRequest: SendFriendRequest
  /** Só vem quando a pessoa está na MESMA call em que você está. */
  audio?: {
    preference: ParticipantAudioPreference | undefined
    onVolumeChange: (volume: number) => void
    onToggleSilenced: () => void
  }
}): React.JSX.Element {
  // Menu CONTROLADO de propósito (padrão único de menu da fase, Plano
  // 08.5-02): `context-menu` do Radix não foi instalado, e um segundo
  // primitivo de menu significaria dois caminhos de teclado para manter. Aqui
  // o MESMO menu abre por clique/Enter no gatilho e por botão direito na
  // linha. Custo aceito e registrado: o menu ancora na linha, não na posição
  // do cursor.
  const [open, setOpen] = useState(false)
  const identifier = `${member.username}#${member.tag}`
  const name = displayNameOf(member)
  const showSpeakingRing = voiceState.speaking && !voiceState.muted

  async function handleCopyIdentifier(): Promise<void> {
    try {
      await navigator.clipboard.writeText(identifier)
      toast.success('Identificador copiado')
    } catch {
      toast.error('Não foi possível copiar o identificador')
    }
  }

  async function handleSendFriendRequest(): Promise<void> {
    try {
      await sendFriendRequest({ username: member.username, tag: member.tag })
      toast.success('Pedido de amizade enviado')
    } catch (err) {
      toast.error(readableConvexError(err))
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {/* Era um `<div>` até o Plano 08.5-04: linha com menu e sem semântica
            de botão é inalcançável por Tab, o defeito de acessibilidade
            clássico. Como `<button>`, a linha entra na ordem de tabulação, o
            Radix já liga Enter/Espaço ao menu e o anel de foco do tema
            (`--ring`, Plano 08.5-01) aparece sem CSS extra. */}
        <button
          type="button"
          className={cn(
            'flex h-11 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-accent',
            !member.online && 'opacity-30'
          )}
          onContextMenu={(event) => {
            event.preventDefault()
            setOpen(true)
          }}
        >
          <UserAvatar
            userId={member.userId}
            avatarUrl={member.avatarUrl}
            name={name}
            size={32}
            status={member.online ? 'online' : 'offline'}
            className={cn(showSpeakingRing && 'rounded-full ring-2 ring-success')}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1">
              <MemberName displayName={name} username={member.username} tag={member.tag} />
              {isOwner ? (
                <Crown
                  className="size-3.5 shrink-0 fill-current text-warning"
                  aria-label="Dono do servidor"
                />
              ) : null}
            </span>
            {voiceState.sharing ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MonitorUp className="size-3 shrink-0 text-voice" aria-hidden="true" />
                <span className="truncate">Compartilhando tela</span>
              </span>
            ) : voiceState.inVoice ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Volume2 className="size-3 shrink-0 text-voice" aria-hidden="true" />
                <span className="truncate">Em voz</span>
              </span>
            ) : null}
          </span>
        </button>
      </DropdownMenuTrigger>
      {/* SÓ ações que já existem no backend hoje. Fora, por decisão explícita:
          - "Enviar mensagem direta": `dms.getOrCreateDmChannel` exige amizade e
            falharia para a maioria dos membros da lista;
          - expulsar/silenciar/gerenciar cargo: não existe mutation, e criá-la
            seria reescrever a autorização do backend — fora desta fase. */}
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onSelect={() => void handleCopyIdentifier()}>
          Copiar identificador
        </DropdownMenuItem>
        {/* Este item (e só ele) aparece para TODO mundo, inclusive para você
            mesmo e para quem já é seu amigo: `listServerMembers` não devolve amizade nem
            identidade do chamador, e descobrir isso exigiria query nova. A
            mutation já responde "Você não pode adicionar a si mesmo" / "Vocês
            já são amigos" em português, e esse erro vira toast — o que é mais
            claro do que um item que some sem explicação. */}
        <DropdownMenuItem onSelect={() => void handleSendFriendRequest()}>
          Adicionar amigo
        </DropdownMenuItem>
        {audio ? (
          <>
            <DropdownMenuSeparator />
            <ParticipantAudioMenuItems
              username={member.username}
              preference={audio.preference}
              onVolumeChange={audio.onVolumeChange}
              onToggleSilenced={audio.onToggleSilenced}
            />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Volume por pessoa só vale para OUTRA pessoa na SUA call (nunca você mesmo:
 * não se ouve). `myUserId` é `room.localParticipant.identity` (= `users._id`). */
export function isInMyCall({
  memberUserId,
  myUserId,
  joinedVoiceChannelId,
  memberChannelId
}: {
  memberUserId: string
  myUserId: string | undefined
  joinedVoiceChannelId: string | null
  memberChannelId: string | undefined
}): boolean {
  if (joinedVoiceChannelId === null || memberChannelId === undefined) return false
  if (memberUserId === myUserId) return false
  return memberChannelId === joinedVoiceChannelId
}

function MemberGroup({
  label,
  members,
  voiceStateByUserId,
  joinedVoiceChannelId,
  speakingUserIds,
  sendFriendRequest,
  ownerId
}: {
  label: string
  members: ServerMember[]
  voiceStateByUserId: Map<Id<'users'>, VoiceParticipant>
  joinedVoiceChannelId: Id<'channels'> | null
  speakingUserIds: Set<string>
  sendFriendRequest: SendFriendRequest
  ownerId: Id<'users'> | undefined
}): React.JSX.Element {
  const { room, participantVolumes, setParticipantVolume, toggleParticipantSilenced } = useVoice()
  return (
    <div>
      <MemberSectionHeader label={label} count={members.length} />
      <div className="flex flex-col gap-0.5">
        {members.map((member) => {
          // Volume por pessoa só vale para quem está na SUA call.
          const inMyCall = isInMyCall({
            memberUserId: member.userId,
            myUserId: room?.localParticipant.identity,
            joinedVoiceChannelId,
            memberChannelId: voiceStateByUserId.get(member.userId)?.channelId
          })
          return (
            <MemberRow
              key={member.userId}
              member={member}
              voiceState={voiceStateFor(
                member,
                voiceStateByUserId,
                joinedVoiceChannelId,
                speakingUserIds
              )}
              isOwner={ownerId === member.userId}
              sendFriendRequest={sendFriendRequest}
              audio={
                inMyCall
                  ? {
                      preference: participantVolumes[member.userId],
                      onVolumeChange: (volume) => setParticipantVolume(member.userId, volume),
                      onToggleSilenced: () => toggleParticipantSilenced(member.userId)
                    }
                  : undefined
              }
            />
          )
        })}
      </div>
    </div>
  )
}

export function MemberList(): React.JSX.Element {
  const { selectedServerId, joinedVoiceChannelId, servers } = useSelection()
  const ownerId = servers?.find((server) => server._id === selectedServerId)?.ownerId
  const { speakingUserIds } = useVoice()
  // Uma única assinatura de mutation para a lista inteira, repassada às linhas
  // (ver `SendFriendRequest` acima).
  const sendFriendRequest = useMutation(api.friends.sendFriendRequest)

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
        <div className="flex flex-col">
          {onlineMembers.length > 0 ? (
            <MemberGroup
              label="Online"
              members={onlineMembers}
              voiceStateByUserId={voiceStateByUserId}
              joinedVoiceChannelId={joinedVoiceChannelId}
              speakingUserIds={speakingUserIds}
              sendFriendRequest={sendFriendRequest}
              ownerId={ownerId}
            />
          ) : null}
          {offlineMembers.length > 0 ? (
            <MemberGroup
              label="Offline"
              members={offlineMembers}
              voiceStateByUserId={voiceStateByUserId}
              joinedVoiceChannelId={joinedVoiceChannelId}
              speakingUserIds={speakingUserIds}
              sendFriendRequest={sendFriendRequest}
              ownerId={ownerId}
            />
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}
