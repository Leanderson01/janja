import { MicOff, MonitorUp } from 'lucide-react'
import { useState } from 'react'

import { ChannelHeader } from '@/components/shell/ChannelHeader'
import { MessageInput } from '@/components/shell/MessageInput'
import { MessageList } from '@/components/shell/MessageList'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  mockChannels,
  mockMembers,
  mockMessages,
  mockVoiceParticipants,
  type Message
} from '@/data/mock-data'
import { useSelection } from '@/state/selection-context'

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

// Visão de chat para canal de texto: mensagens mockadas + eco local das
// mensagens enviadas nesta sessão. `sentMessages` reseta a cada troca de
// canal porque este componente é remontado com `key={channelId}` pelo
// chamador (ConversationArea) — o eco local não deve "vazar" para outro
// canal nem persistir, é puramente uma simulação de UI desta fase. Remontar
// via `key` é preferível a um `useEffect` que chama `setState` só para
// zerar estado no mount (anti-padrão sinalizado por
// `react-hooks/set-state-in-effect`).
function TextChannelView({
  channelId,
  firstUnreadMessageId
}: {
  channelId: string
  firstUnreadMessageId?: string
}): React.JSX.Element {
  const [sentMessages, setSentMessages] = useState<Message[]>([])

  const messages = [...mockMessages.filter((m) => m.channelId === channelId), ...sentMessages].sort(
    (a, b) => a.createdAt - b.createdAt
  )

  function handleSend(content: string): void {
    setSentMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        channelId,
        authorId: 'me',
        content,
        createdAt: Date.now()
      }
    ])
  }

  return (
    <>
      <div className="flex-1 min-h-0">
        <MessageList messages={messages} firstUnreadMessageId={firstUnreadMessageId} />
      </div>
      <MessageInput onSend={handleSend} />
    </>
  )
}

// Área de conversa (Plano 03-03) — substitui o stub do Plano 01. Alterna
// entre a visão de chat (canal de texto) e a visão de participantes de voz,
// inteiramente orientada por `selectedChannelId` do SelectionProvider
// (Plano 01), sem nenhum backend.
export function ConversationArea(): React.JSX.Element {
  const { selectedChannelId } = useSelection()
  const channel = mockChannels.find((c) => c.id === selectedChannelId)

  return (
    <div className="h-full flex flex-col">
      <ChannelHeader />
      {!channel ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground">
          Nenhum canal selecionado
        </div>
      ) : channel.type === 'voice' ? (
        <VoiceChannelView channelId={channel.id} />
      ) : (
        <TextChannelView
          key={channel.id}
          channelId={channel.id}
          firstUnreadMessageId={channel.firstUnreadMessageId}
        />
      )}
    </div>
  )
}
