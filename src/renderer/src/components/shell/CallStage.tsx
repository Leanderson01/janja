import { useQuery } from 'convex/react'
import { ConnectionQuality } from 'livekit-client'
import {
  MicOff,
  MonitorUp,
  SignalHigh,
  SignalLow,
  SignalMedium,
  SignalZero,
  Volume2
} from 'lucide-react'
import { useEffect, useRef } from 'react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { useSelection } from '@/state/selection-context'
import { useVoice, type ScreenShareTrack } from '@/state/voice-context'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

// Palco da call (Plano 08.5-03). Tudo neste arquivo veio de
// `ConversationArea.tsx` por MOVIMENTO, não por reescrita: a área principal
// deixou de ser "a área de conversa" e virou um palco que alterna entre texto e
// call, e o palco precisa ser um componente próprio para que os planos 08.5-07
// (compartilhamento no palco) e 08.5-11 (VOICE-18) editem só ele.
//
// ATENÇÃO ao `useEffect` de `attach`/`detach` do `ScreenShareTile` mais abaixo:
// ele é cópia literal do que estava em `ConversationArea.tsx`, dependência
// `[entry.track]` inclusa. O contrato da Fase 8 (08-06-SUMMARY.md) é que o
// `<video>` nasce de `track.attach()` e some porque o REACT desmonta o
// componente — o SDK não remove elemento do DOM. "Melhorar" esse efeito traz de
// volta o frame congelado que o Plano 08-06 existiu para matar.

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

// Grid de participantes de um canal de voz (Plano 07-04) — dado real de
// `voiceStates` via `api.voice.voiceParticipantsByChannel`, em versão
// grande (~80px), com o mesmo padrão de anel verde para "falando" e ícone
// de mute sobre o avatar que a Fase 3 desenhou sobre o mock. Esta tela pode
// mostrar um canal diferente do canal ao qual o `Room` local está
// conectado (usuário navegando para ver quem está lá sem entrar) — mute
// sempre vem de `voiceStates` (visível para qualquer um), mas anel de fala
// e qualidade de conexão só existem para o canal realmente conectado.
export function VoiceParticipantGrid({
  channelId
}: {
  channelId: Id<'channels'>
}): React.JSX.Element {
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
              <Avatar className={cn('size-20', isSpeaking && 'ring-4 ring-success')}>
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

// SHARE-02 (Plano 08-06): um `<video>` de tela compartilhada.
//
// O elemento NUNCA é escrito em JSX (`<video src=...>`) — ele nasce de
// `track.attach()` e é enxertado no container por este efeito
// (08-RESEARCH.md §6). Não é preferência de estilo: `attach()` registra o
// elemento na track, e é isso que permite ao SDK alcançá-lo depois
// (`switchActiveDevice`, `setSinkId`, limpeza na desinscrição). Um `<video>`
// com `srcObject` setado à mão é invisível para o SDK.
//
// O cleanup roda em 100% dos caminhos de desmonte porque quem o dispara é o
// React, não um evento do LiveKit: a track sai de `screenShareTracks` (por
// despublicação, queda do apresentador ou desconexão nossa) → o componente
// desmonta → `detach` + `remove`. Mesma classe de vazamento que a quick task
// 001 corrigiu na voz: elemento de mídia sobrevivendo ao dono da stream.
function ScreenShareTile({ entry }: { entry: ScreenShareTrack }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const element = entry.track.attach()
    element.className = 'h-full w-full object-contain'
    // Nada de mexer em `element.muted` aqui. `attachToElement` do SDK já faz
    // `element.muted = mediaStream.getAudioTracks().length === 0` — e a
    // stream de uma track de tela é só vídeo, então o elemento SEMPRE nasce
    // mudo. Setar `muted = false` por conta própria (a primeira versão deste
    // efeito fazia isso nas telas remotas) desarma justamente a salvaguarda
    // que garante o autoplay: elemento com som e sem gesto do usuário é
    // `NotAllowedError` na política do Chromium, e o sintoma seria "o vídeo
    // remoto não aparece" — longe da causa. O áudio de sistema do
    // compartilhamento (SHARE-03) não passa por aqui: é uma track separada
    // (`ScreenShareAudio`), anexada ao container invisível de áudio do
    // `voice-context`.
    container.appendChild(element)

    return () => {
      // `detach(element)` (com argumento) desfaz só o NOSSO elemento — outro
      // consumidor da mesma track, se existir, não é afetado. É no-op seguro
      // quando o SDK já desanexou tudo sozinho, o que acontece na
      // desinscrição (`RemoteTrackPublication.setTrack(undefined)` chama
      // `detach()`) — mas ele não REMOVE o elemento do DOM, e é essa remoção
      // aqui que impede o quadrado morto na tela.
      entry.track.detach(element)
      element.remove()
    }
  }, [entry.track])

  return (
    <div
      ref={containerRef}
      data-screenshare-tile={entry.trackSid}
      className="relative flex h-full min-h-40 min-w-64 flex-1 items-center justify-center overflow-hidden rounded-lg bg-black"
    />
  )
}

// Região de compartilhamento de tela do canal de voz. Duas fontes distintas,
// como o Plano 07-04 já estabeleceu para fala/qualidade:
//
// - o VÍDEO só existe para quem está conectado a ESTE canal (`isConnectedHere`)
//   — dado efêmero do `Room` local, nunca do Convex. Um canal apenas
//   visualizado não tem track nenhuma para ler, e fingir que tem seria
//   mostrar vídeo de outro canal.
// - o ÍCONE de "está compartilhando" para quem está de fora vive na sidebar e
//   na lista de membros (Task 2), alimentado por `voiceStates.sharing`.
//
// MVP explícito: mais de uma tela ao mesmo tempo cai num grid `flex-wrap`
// simples, sem UI de destacar/focar um stream (nenhum requisito pede, e não
// há sinal de que o grupo compartilhe em paralelo com frequência).
function ScreenShareStage({ channelId }: { channelId: Id<'channels'> }): React.JSX.Element {
  const { joinedVoiceChannelId } = useSelection()
  const { screenShareTracks } = useVoice()
  const isConnectedHere = channelId === joinedVoiceChannelId

  // Só para rotular cada tela com o nome de quem compartilha: `identity` do
  // LiveKit é o `users._id`, que não se mostra a ninguém. Mesma query que
  // `VoiceParticipantGrid` já assina (o cliente do Convex compartilha a
  // subscrição por query+args, não abre uma segunda), e `'skip'` quando não
  // há vídeo possível para rotular.
  const participants = useQuery(
    api.voice.voiceParticipantsByChannel,
    isConnectedHere ? { channelId } : 'skip'
  )
  const usernameByIdentity = new Map(
    (participants ?? []).map((participant) => [String(participant.userId), participant.username])
  )

  const tracks = isConnectedHere ? screenShareTracks : []

  if (tracks.length === 0) {
    return (
      <div className="flex-1 min-h-40 w-full flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-muted-foreground">
        <MonitorUp className="size-8" aria-hidden="true" />
        <span className="text-sm">
          {isConnectedHere
            ? 'Ninguém está compartilhando a tela'
            : 'Entre no canal para ver a tela compartilhada'}
        </span>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-40 w-full flex flex-wrap items-stretch justify-center gap-3">
      {tracks.map((entry) => (
        <div key={entry.trackSid} className="relative flex min-h-40 min-w-64 flex-1 flex-col">
          <ScreenShareTile entry={entry} />
          <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-background/80 px-1.5 py-0.5 text-xs text-foreground">
            {entry.isLocal
              ? 'Sua tela'
              : (usernameByIdentity.get(entry.participantIdentity) ?? 'Tela compartilhada')}
          </span>
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
// `voiceParticipantsByChannel` é a mesma do `VoiceParticipantGrid` logo abaixo —
// o cliente do Convex compartilha subscrição por query+args.
//
// Nada de botão aqui. Alternar a lista de membros e os controles de
// compartilhamento entram no Plano 08.5-07, depois que o `layout-context`
// existir (Plano 08.5-05); acrescentá-los agora seria importar de um plano da
// mesma onda.
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
// compartilhada. Era `VoiceChannelView` dentro de `ConversationArea.tsx`; o
// conteúdo abaixo da barra está igual ao que estava lá, incluindo o
// `overflow-y-auto`.
//
// Por que NÃO virou `ScrollArea` (a convenção da fase pediria): o
// `ScreenShareStage` se dimensiona com `flex-1 min-h-40`, contando com um pai
// flex de altura definida. Dentro do `ScrollArea`, o `Viewport` do Radix embrulha
// os filhos num elemento `display: table` — o pai deixa de ser flex e o `flex-1`
// vira letra morta, deixando a região de vídeo com os 160px do `min-h-40`.
// Regressão de vídeo é pior que um `overflow-y-auto` sobrevivente, e o layout
// definitivo do palco (vídeo grande, participantes em faixa) é o Plano 08.5-07.
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
