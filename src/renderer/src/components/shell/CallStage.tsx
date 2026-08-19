import { useQuery } from 'convex/react'
import { MicOff, Volume2 } from 'lucide-react'

import {
  ConnectionQualityIcon,
  initialsFor,
  useVoiceParticipants
} from '@/components/shell/ParticipantStrip'
import { ScreenShareStage } from '@/components/shell/ScreenShareStage'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

// Palco da call (Plano 08.5-03, layout de compartilhamento no Plano 08.5-07).
//
// O arquivo nasceu de `ConversationArea.tsx` por MOVIMENTO, não por reescrita.
// No Plano 08.5-07 ele se dividiu de novo, também por movimento:
//
// - `ScreenShareStage.tsx` — a região de vídeo e o `ScreenShareTile`, com o
//   `useEffect` de `attach`/`detach` da Fase 8 intocado (a prova por `diff`
//   está no summary do plano).
// - `ParticipantStrip.tsx` — a faixa horizontal de participantes E as regras
//   comuns de participante de voz (`initialsFor`, `ConnectionQualityIcon`,
//   `useVoiceParticipants`), que a grade abaixo importa em vez de duplicar.
//
// A importação vai só numa direção (`CallStage` → os dois arquivos novos), de
// propósito: `ParticipantStrip` importando de volta daqui criaria ciclo.

// Grid de participantes de um canal de voz (Plano 07-04) — dado real de
// `voiceStates` via `api.voice.voiceParticipantsByChannel`, em versão
// grande (~80px), com o mesmo padrão de anel verde para "falando" e ícone
// de mute sobre o avatar que a Fase 3 desenhou sobre o mock. Esta tela pode
// mostrar um canal diferente do canal ao qual o `Room` local está
// conectado (usuário navegando para ver quem está lá sem entrar) — mute
// sempre vem de `voiceStates` (visível para qualquer um), mas anel de fala
// e qualidade de conexão só existem para o canal realmente conectado. Essa
// combinação mora em `useVoiceParticipants`.
export function VoiceParticipantGrid({
  channelId
}: {
  channelId: Id<'channels'>
}): React.JSX.Element {
  const participants = useVoiceParticipants(channelId)

  if (!participants || participants.length === 0) {
    return <div className="text-sm text-muted-foreground">Nenhum participante conectado</div>
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      {participants.map((participant) => (
        <div key={participant.userId} className="flex flex-col items-center gap-2">
          <div className="relative">
            <Avatar className={cn('size-20', participant.isSpeaking && 'ring-4 ring-success')}>
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
            <ConnectionQualityIcon quality={participant.quality} />
          </div>
        </div>
      ))}
    </div>
  )
}

// Barra do palco (Plano 08.5-03): mesma altura do `ChannelHeader` (h-12) e a
// mesma borda, para que a linha do topo da janela não pule ao alternar entre
// texto e call. O `ChannelHeader` NÃO é renderizado no modo palco — ele descreve
// o canal SELECIONADO, que durante uma call pode ser um canal de texto qualquer,
// e um cabeçalho descrevendo outra coisa que não está na tela é pior que
// nenhum.
//
// Duas queries, nenhuma subscrição nova: `getChannel` é a mesma que o
// `ChannelHeader` e a `VoiceControlBar` já assinam, e
// `voiceParticipantsByChannel` é a mesma de `useVoiceParticipants` —
// o cliente do Convex compartilha subscrição por query+args.
function StageBar({ channelId }: { channelId: Id<'channels'> }): React.JSX.Element {
  const channel = useQuery(api.channels.getChannel, { channelId })
  const participants = useQuery(api.voice.voiceParticipantsByChannel, { channelId })
  const count = participants?.length ?? 0

  return (
    <div className="flex-none h-12 flex items-center gap-3 px-4 border-b border-border">
      <Volume2 className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
        {channel?.name ?? '...'}
      </span>
      <span className="shrink-0 text-sm text-muted-foreground">
        {count === 1 ? '1 participante' : `${count} participantes`}
      </span>
    </div>
  )
}

// O palco da call: barra própria, ladrilhos dos participantes e região de tela
// compartilhada.
//
// Por que NÃO virou `ScrollArea` (a convenção da fase pediria): o
// `ScreenShareStage` se dimensiona contando com um pai flex de altura definida.
// Dentro do `ScrollArea`, o `Viewport` do Radix embrulha os filhos num elemento
// `display: table` — o pai deixa de ser flex e o `flex-1` vira letra morta,
// deixando a região de vídeo com a altura mínima. Regressão de vídeo é pior que
// um `overflow-y-auto` sobrevivente.
//
// `bg-background`, igual à área de texto: um fundo mais escuro que o
// `--background` não existe nos tokens de hoje, e inventar um token é decisão de
// paleta — fica para o checkpoint humano (Plano 08.5-17) dizer se faz falta.
export function CallStage({ channelId }: { channelId: Id<'channels'> }): React.JSX.Element {
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-background">
      <StageBar channelId={channelId} />
      <div className="flex-1 min-h-0 flex flex-col items-center gap-4 overflow-y-auto p-8">
        <VoiceParticipantGrid channelId={channelId} />
        <ScreenShareStage channelId={channelId} />
      </div>
    </div>
  )
}
