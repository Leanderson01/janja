import { useState } from 'react'
import { MicOff, MonitorUp } from 'lucide-react'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { toast } from 'sonner'

import { Avatar, AvatarBadge, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useSelection } from '@/state/selection-context'
import { useVoice } from '@/state/voice-context'
import { readableConvexError } from '@/lib/convex-error'

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
      <Avatar className={cn(showSpeakingRing && 'ring-2 ring-success')}>
        <AvatarFallback>{initialsFor(member.username)}</AvatarFallback>
      </Avatar>
      <AvatarBadge
        className={cn(member.online ? 'bg-success' : 'bg-muted-foreground')}
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
          `text-success` porque o estado é ativo/positivo, ao contrário do
          mute — token semântico, nunca cor direta do Tailwind (08.5-01). */}
      {voiceState.sharing ? (
        <span
          className="absolute -left-1 -top-1 z-10 flex size-3.5 items-center justify-center rounded-full bg-background text-success ring-1 ring-background"
          aria-label="compartilhando a tela"
        >
          <MonitorUp className="size-2.5" />
        </span>
      ) : null}
    </div>
  )
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
  sendFriendRequest
}: {
  member: ServerMember
  voiceState: VoiceState
  sendFriendRequest: SendFriendRequest
}): React.JSX.Element {
  // Menu CONTROLADO de propósito (padrão único de menu da fase, Plano
  // 08.5-02): `context-menu` do Radix não foi instalado, e um segundo
  // primitivo de menu significaria dois caminhos de teclado para manter. Aqui
  // o MESMO menu abre por clique/Enter no gatilho e por botão direito na
  // linha. Custo aceito e registrado: o menu ancora na linha, não na posição
  // do cursor.
  const [open, setOpen] = useState(false)
  const identifier = `${member.username}#${member.tag}`

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
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent/50"
          onContextMenu={(event) => {
            event.preventDefault()
            setOpen(true)
          }}
        >
          <MemberAvatar member={member} voiceState={voiceState} />
          <MemberName username={member.username} tag={member.tag} />
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
        {/* O item aparece para TODO mundo, inclusive para você mesmo e para
            quem já é seu amigo: `listServerMembers` não devolve amizade nem
            identidade do chamador, e descobrir isso exigiria query nova. A
            mutation já responde "Você não pode adicionar a si mesmo" / "Vocês
            já são amigos" em português, e esse erro vira toast — o que é mais
            claro do que um item que some sem explicação. */}
        <DropdownMenuItem onSelect={() => void handleSendFriendRequest()}>
          Adicionar amigo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MemberGroup({
  label,
  members,
  voiceStateByUserId,
  joinedVoiceChannelId,
  speakingUserIds,
  sendFriendRequest,
  dimmed = false
}: {
  label: string
  members: ServerMember[]
  voiceStateByUserId: Map<Id<'users'>, VoiceParticipant>
  joinedVoiceChannelId: Id<'channels'> | null
  speakingUserIds: Set<string>
  sendFriendRequest: SendFriendRequest
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
            sendFriendRequest={sendFriendRequest}
          />
        ))}
      </div>
    </div>
  )
}

export function MemberList(): React.JSX.Element {
  const { selectedServerId, joinedVoiceChannelId } = useSelection()
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
        <div className="flex flex-col gap-4 p-3">
          {onlineMembers.length > 0 ? (
            <MemberGroup
              label="ONLINE"
              members={onlineMembers}
              voiceStateByUserId={voiceStateByUserId}
              joinedVoiceChannelId={joinedVoiceChannelId}
              speakingUserIds={speakingUserIds}
              sendFriendRequest={sendFriendRequest}
            />
          ) : null}
          {offlineMembers.length > 0 ? (
            <MemberGroup
              label="OFFLINE"
              members={offlineMembers}
              voiceStateByUserId={voiceStateByUserId}
              joinedVoiceChannelId={joinedVoiceChannelId}
              speakingUserIds={speakingUserIds}
              sendFriendRequest={sendFriendRequest}
              dimmed
            />
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}
