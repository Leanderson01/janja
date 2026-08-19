import { useMutation, useQuery } from 'convex/react'
import { ConnectionQuality } from 'livekit-client'
import { MicOff, MonitorUp, SignalHigh, SignalLow, SignalMedium, SignalZero } from 'lucide-react'
import { useRef } from 'react'

import { ChannelHeader } from '@/components/shell/ChannelHeader'
import { MessageInput } from '@/components/shell/MessageInput'
import { MessageList } from '@/components/shell/MessageList'
import { TypingIndicator } from '@/components/shell/TypingIndicator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useSelection } from '@/state/selection-context'
import { useVoice } from '@/state/voice-context'

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

// VOICE-15: barra/indicador de 4 níveis de qualidade de conexão. `quality`
// vem de `useVoice().connectionQualities`, dado 100% efêmero do LiveKit —
// só é passado adiante quando o participante está no MESMO canal ao qual o
// usuário local está conectado (ver `isConnectedHere` em
// `VoiceParticipantGrid`); fora disso o chamador passa `undefined` e nenhum
// ícone aparece. `Unknown` também não renderiza nada — "sem dado ainda" não
// é um 5º nível visível (07-RESEARCH.md §3).
function ConnectionQualityIcon({
  quality
}: {
  quality: ConnectionQuality | undefined
}): React.JSX.Element | null {
  switch (quality) {
    case ConnectionQuality.Excellent:
      return <SignalHigh className="size-4 text-green-500" aria-label="Conexão excelente" />
    case ConnectionQuality.Good:
      return <SignalMedium className="size-4 text-amber-500" aria-label="Conexão boa" />
    case ConnectionQuality.Poor:
      return <SignalLow className="size-4 text-destructive" aria-label="Conexão ruim" />
    case ConnectionQuality.Lost:
      return <SignalZero className="size-4 text-destructive" aria-label="Conexão perdida" />
    default:
      return null
  }
}

// Grid de participantes de um canal de voz (Plano 07-04) — dado real de
// `voiceStates` via `api.voice.voiceParticipantsByChannel`, em versão
// grande (~80px), com o mesmo padrão de anel verde para "falando" e ícone
// de mute sobre o avatar que a Fase 3 desenhou sobre o mock. Esta tela pode
// mostrar um canal diferente do canal ao qual o `Room` local está
// conectado (usuário navegando para ver quem está lá sem entrar) — mute
// sempre vem de `voiceStates` (visível para qualquer um), mas anel de fala
// e qualidade de conexão só existem para o canal realmente conectado.
function VoiceParticipantGrid({ channelId }: { channelId: Id<'channels'> }): React.JSX.Element {
  const { joinedVoiceChannelId } = useSelection()
  const { speakingUserIds, connectionQualities } = useVoice()
  const participants = useQuery(api.voice.voiceParticipantsByChannel, { channelId })

  const isConnectedHere = channelId === joinedVoiceChannelId

  if (!participants || participants.length === 0) {
    return <div className="text-sm text-muted-foreground">Nenhum participante conectado</div>
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      {participants.map((participant) => {
        // Combina as duas condições explicitamente — nunca assume que
        // `speakingUserIds`/`connectionQualities` sozinhos já implicam
        // "este é o canal conectado".
        const isSpeaking = isConnectedHere && speakingUserIds.has(participant.userId)
        const quality = isConnectedHere ? connectionQualities.get(participant.userId) : undefined

        return (
          <div key={participant.userId} className="flex flex-col items-center gap-2">
            <div className="relative">
              <Avatar className={'size-20' + (isSpeaking ? ' ring-4 ring-green-500' : '')}>
                <AvatarFallback className="text-lg">
                  {initialsFor(participant.username)}
                </AvatarFallback>
              </Avatar>
              {participant.muted ? (
                <span className="absolute bottom-0 right-0 flex size-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground ring-2 ring-background">
                  <MicOff className="size-3.5" aria-hidden="true" />
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-foreground">{participant.username}</span>
              <ConnectionQualityIcon quality={quality} />
            </div>
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
function VoiceChannelView({ channelId }: { channelId: Id<'channels'> }): React.JSX.Element {
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
// (`convex/messages.ts`); a partir do Plano 07-04, `VoiceChannelView` usa
// participantes reais de `voiceStates` — nenhum componente deste arquivo lê
// mais `mock-data.ts`.
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
