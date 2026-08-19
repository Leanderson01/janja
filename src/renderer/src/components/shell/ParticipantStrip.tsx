import { useQuery } from 'convex/react'
import { ConnectionQuality } from 'livekit-client'
import { MicOff, MonitorUp, SignalHigh, SignalLow, SignalMedium, SignalZero } from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { useSelection } from '@/state/selection-context'
import { useVoice } from '@/state/voice-context'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

// Faixa horizontal de participantes do palco (Plano 08.5-07), usada quando o
// compartilhamento de tela toma a área grande e os participantes descem para
// um friso embaixo.
//
// Este arquivo é também a CASA COMUM das regras de participante de voz —
// `initialsFor`, `ConnectionQualityIcon` e `useVoiceParticipants` vivem aqui e
// são importados por `CallStage.tsx` (grade grande) e usados aqui (faixa
// pequena). A direção da importação é uma só (`CallStage` → `ParticipantStrip`)
// para não criar ciclo de módulos.
//
// O motivo de a regra ser compartilhada e não copiada está registrado desde a
// Fase 7: `speaking` e `quality` são dados EFÊMEROS do `Room` do LiveKit e só
// valem para o canal ao qual o cliente está de fato conectado; `muted` e
// `sharing` vêm do Convex e valem para qualquer canal visualizado. Duplicar
// essa combinação em dois componentes é duplicar o caso de borda.

export function initialsFor(username: string): string {
  return username.slice(0, 2).toUpperCase()
}

// VOICE-15: barra/indicador de 4 níveis de qualidade de conexão. `quality`
// vem de `useVoice().connectionQualities`, dado 100% efêmero do LiveKit —
// só chega aqui preenchido quando o participante está no MESMO canal ao qual o
// usuário local está conectado (ver `useVoiceParticipants`); fora disso é
// `undefined` e nenhum ícone aparece. `Unknown` também não renderiza nada —
// "sem dado ainda" não é um 5º nível visível (07-RESEARCH.md §3).
export function ConnectionQualityIcon({
  quality
}: {
  quality: ConnectionQuality | undefined
}): React.JSX.Element | null {
  switch (quality) {
    case ConnectionQuality.Excellent:
      return <SignalHigh className="size-4 text-success" aria-label="Conexão excelente" />
    case ConnectionQuality.Good:
      return <SignalMedium className="size-4 text-warning" aria-label="Conexão boa" />
    case ConnectionQuality.Poor:
      return <SignalLow className="size-4 text-destructive" aria-label="Conexão ruim" />
    case ConnectionQuality.Lost:
      return <SignalZero className="size-4 text-destructive" aria-label="Conexão perdida" />
    default:
      return null
  }
}

export type VoiceParticipantView = {
  userId: Id<'users'>
  username: string
  muted: boolean
  sharing: boolean
  isSpeaking: boolean
  quality: ConnectionQuality | undefined
}

// Participantes de um canal de voz, já combinados com o estado efêmero do
// `Room`. Devolve `undefined` enquanto a query do Convex não respondeu (o
// chamador distingue "carregando" de "canal vazio").
//
// Nenhuma subscrição nova: `voiceParticipantsByChannel` é a mesma query que a
// `StageBar` e a grade já assinam, e o cliente do Convex compartilha a
// subscrição por query+args.
export function useVoiceParticipants(
  channelId: Id<'channels'>
): VoiceParticipantView[] | undefined {
  const { joinedVoiceChannelId } = useSelection()
  const { speakingUserIds, connectionQualities } = useVoice()
  const participants = useQuery(api.voice.voiceParticipantsByChannel, { channelId })

  const isConnectedHere = channelId === joinedVoiceChannelId

  if (!participants) return undefined

  return participants.map((participant) => ({
    userId: participant.userId,
    username: participant.username,
    muted: participant.muted,
    sharing: participant.sharing,
    // Combina as duas condições explicitamente — nunca assume que
    // `speakingUserIds`/`connectionQualities` sozinhos já implicam
    // "este é o canal conectado".
    isSpeaking: isConnectedHere && speakingUserIds.has(participant.userId),
    quality: isConnectedHere ? connectionQualities.get(participant.userId) : undefined
  }))
}

// A faixa é uma FAIXA: `flex-nowrap` + `overflow-x-auto`. Quebrar em duas
// linhas transformaria o friso numa segunda grade e comeria a altura que o
// vídeo acabou de ganhar — em janela de 900px de largura com a lista de
// membros aberta sobra pouco espaço horizontal, e rolar é o comportamento
// correto (Plano 08.5-07, task 3).
//
// `ScrollArea` do Radix não foi usada aqui pelo mesmo motivo registrado no
// Plano 08.5-03: o `Viewport` embrulha os filhos num `display: table` e
// desmancharia o `flex` da faixa.
//
// Os anéis dos badges são `ring-stage`, não `ring-background`: eles simulam um
// recorte no fundo atrás do avatar, e a faixa só existe dentro do palco, cujo
// fundo é `--stage`. A grade grande (`VoiceParticipantGrid`) continua com
// `ring-background` porque ela também é renderizada na PRÉVIA de canal de voz,
// que fica sobre `--background`.
export function ParticipantStrip({ channelId }: { channelId: Id<'channels'> }): React.JSX.Element {
  const participants = useVoiceParticipants(channelId)

  if (!participants || participants.length === 0) {
    return (
      <div className="flex h-full items-center text-sm text-muted-foreground">
        Nenhum participante conectado
      </div>
    )
  }

  return (
    <div
      className="flex h-full flex-nowrap items-center gap-3 overflow-x-auto overflow-y-hidden"
      role="list"
      aria-label="Participantes do canal de voz"
    >
      {participants.map((participant) => (
        <div
          key={participant.userId}
          role="listitem"
          className="flex shrink-0 items-center gap-2 rounded-md px-1"
        >
          <div className="relative">
            <Avatar className={cn('size-9', participant.isSpeaking && 'ring-2 ring-success')}>
              <AvatarFallback className="text-xs">
                {initialsFor(participant.username)}
              </AvatarFallback>
            </Avatar>
            {participant.muted ? (
              <span
                className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground ring-2 ring-stage"
                aria-label="Microfone desativado"
              >
                <MicOff className="size-2.5" aria-hidden="true" />
              </span>
            ) : null}
            {/* Canto superior ESQUERDO, mesma convenção da `MemberList` (Plano
                08-06): direita inferior é do mute e direita superior fica livre
                para o badge de presença quando ele chegar aqui. */}
            {participant.sharing ? (
              <span
                className="absolute -left-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-success text-success-foreground ring-2 ring-stage"
                aria-label="Compartilhando a tela"
              >
                <MonitorUp className="size-2.5" aria-hidden="true" />
              </span>
            ) : null}
          </div>
          <span className="max-w-28 truncate text-xs text-foreground">{participant.username}</span>
          <ConnectionQualityIcon quality={participant.quality} />
        </div>
      ))}
    </div>
  )
}
