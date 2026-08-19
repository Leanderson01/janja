import { useMutation, useQuery } from 'convex/react'
import { MicOff, MonitorUp } from 'lucide-react'
import { useRef } from 'react'

import { ChannelHeader } from '@/components/shell/ChannelHeader'
import { MessageInput } from '@/components/shell/MessageInput'
import { MessageList } from '@/components/shell/MessageList'
import { TypingIndicator } from '@/components/shell/TypingIndicator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { mockMembers, mockVoiceParticipants } from '@/data/mock-data'
import { useSelection } from '@/state/selection-context'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

// Throttle de escrita de "estou digitando" (CHAT-07): no máximo 1 mutation a
// cada ~2s por usuário digitando, independente da velocidade de digitação —
// mesma folga 2x-3x que TYPING_TTL_MS do TypingIndicator usa como referência
// (05-RESEARCH.md §7). Evita escrever no banco a cada tecla (PITFALLS.md,
// Performance Traps).
const TYPING_THROTTLE_MS = 2000

function initialsFor(username: string): string {
  return username.slice(0, 2).toUpperCase()
}

// Grid de participantes de um canal de voz (mesmo dado — mockVoiceParticipants
// — que o Plano 02 usa na sidebar; aqui em versão grande, ~80px, com o mesmo
// padrão de anel verde para "falando" e ícone de mute sobre o avatar).
function VoiceParticipantGrid({ channelId }: { channelId: string }): React.JSX.Element {
  const participants = mockVoiceParticipants.filter((p) => p.channelId === channelId)

  if (participants.length === 0) {
    return <div className="text-sm text-muted-foreground">Nenhum participante conectado</div>
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      {participants.map((participant) => {
        const member = mockMembers.find((m) => m.id === participant.memberId)
        return (
          <div key={participant.memberId} className="flex flex-col items-center gap-2">
            <div className="relative">
              <Avatar
                className={'size-20' + (participant.speaking ? ' ring-4 ring-green-500' : '')}
              >
                <AvatarFallback className="text-lg">
                  {initialsFor(member?.username ?? '??')}
                </AvatarFallback>
              </Avatar>
              {participant.muted ? (
                <span className="absolute bottom-0 right-0 flex size-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground ring-2 ring-background">
                  <MicOff className="size-3.5" aria-hidden="true" />
                </span>
              ) : null}
            </div>
            <span className="text-sm text-foreground">{member?.username ?? 'Desconhecido'}</span>
          </div>
        )
      })}
    </div>
  )
}

// Visão alternativa para canal de voz: grid de participantes + placeholder
// de compartilhamento de tela (F8). O placeholder já reserva o layout final
// (região com `flex-1 min-h-0` abaixo do grid) para que F8 só troque o
// conteúdo interno, sem redesenhar esta região.
function VoiceChannelView({ channelId }: { channelId: string }): React.JSX.Element {
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center gap-4 overflow-y-auto p-8">
      <VoiceParticipantGrid channelId={channelId} />
      <div className="flex-1 min-h-40 w-full flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-muted-foreground">
        <MonitorUp className="size-8" aria-hidden="true" />
        <span className="text-sm">Área de compartilhamento de tela — chega em F8</span>
      </div>
    </div>
  )
}

// Visão de chat para canal de texto: histórico real e envio real, ambos via
// Convex. `MessageList` é remontada com `key={channelId}` pelo chamador
// (ConversationArea) ao trocar de canal — reseta o estado interno de scroll
// da lista (mesmo padrão de remount por `key` já usado desde a Fase 3).
function TextChannelView({ channelId }: { channelId: Id<'channels'> }): React.JSX.Element {
  const sendMessage = useMutation(api.messages.sendMessage)
  const setTyping = useMutation(api.typing.setTyping)
  const lastTypingCallRef = useRef(0)

  function handleSend(content: string): void {
    sendMessage({ channelId, content }).catch(() => {})
  }

  function handleTyping(): void {
    const now = Date.now()
    if (now - lastTypingCallRef.current < TYPING_THROTTLE_MS) return
    lastTypingCallRef.current = now
    setTyping({ channelId }).catch(() => {})
  }

  return (
    <>
      <div className="flex-1 min-h-0">
        <MessageList channelId={channelId} />
      </div>
      <TypingIndicator channelId={channelId} />
      <MessageInput onSend={handleSend} onTyping={handleTyping} />
    </>
  )
}

// Área de conversa (Plano 03-03) — alterna entre a visão de chat (canal de
// texto) e a visão de participantes de voz, orientada por `selectedChannelId`
// do SelectionProvider. O canal em si vem de `api.channels.getChannel` (mesma
// query de ChannelHeader — subscrição duplicada é esperada e barata). A
// partir do plano 05-04, `TextChannelView` usa mensagens/envio reais
// (`convex/messages.ts`) — só `mockVoiceParticipants` segue como stub de voz
// (F7), já que nenhum id mockado bate com um `Id<'channels'>` real.
export function ConversationArea(): React.JSX.Element {
  const { selectedChannelId } = useSelection()
  const channel = useQuery(
    api.channels.getChannel,
    selectedChannelId ? { channelId: selectedChannelId } : 'skip'
  )

  return (
    <div className="h-full flex flex-col">
      <ChannelHeader />
      {!channel ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground">
          Nenhum canal selecionado
        </div>
      ) : channel.type === 'voice' ? (
        <VoiceChannelView channelId={channel._id} />
      ) : (
        <TextChannelView key={channel._id} channelId={channel._id} />
      )}
    </div>
  )
}
