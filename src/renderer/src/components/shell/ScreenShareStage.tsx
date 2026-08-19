import { useQuery } from 'convex/react'
import { MonitorUp } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'
import { useSelection } from '@/state/selection-context'
import { useVoice, type ScreenShareTrack } from '@/state/voice-context'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

// Região de vídeo do palco (Plano 08.5-07). O conteúdo deste arquivo veio de
// `CallStage.tsx` por MOVIMENTO — que por sua vez o recebeu de
// `ConversationArea.tsx` no Plano 08.5-03. O `ScreenShareTile` abaixo,
// comentário incluso, é byte a byte o da Fase 8: a extração foi provada por
// `diff` contra o `HEAD` anterior, não por leitura.
//
// A REGRA QUE MANDA NESTE ARQUIVO (08-06-SUMMARY.md): o `<video>` nasce de
// `track.attach()` e só sai da tela porque o REACT desmonta este componente —
// `detachTrack()` do SDK zera `srcObject` e NADA MAIS, nunca removendo o
// elemento do DOM. Consequência para quem mexe em layout: enquanto a track
// existir, o tile NÃO pode ser desmontado por causa de layout. Recolher e
// expandir (Plano 08.5-07) trocam CLASSE de container no `CallStage`; nenhuma
// renderização condicional envolve este componente enquanto há track. Quem
// trocar isso por um ternário traz de volta o frame congelado que o Plano
// 08-06 existiu para matar.

// Moldura tracejada usada nos dois estados "não há vídeo aqui". Fica neste
// arquivo porque a região de vídeo é dele; quem renderiza a prévia de canal de
// voz (`VoiceParticipantGrid`, em `CallStage.tsx`) importa o aviso em vez de
// copiar a moldura.
function ShareNotice({
  className,
  children
}: {
  className?: string
  children: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-muted-foreground',
        className
      )}
    >
      <MonitorUp className="size-8" aria-hidden="true" />
      <span className="text-sm">{children}</span>
    </div>
  )
}

// O convite que a prévia de canal de voz (canal onde você NÃO está) perdeu no
// Plano 08.5-03, quando a região de vídeo saiu de lá — registrado no summary
// daquele plano como pendência deste. `flex-none`: na prévia a moldura mora
// dentro de um container rolável e não deve esticar até o rodapé.
export function ScreenSharePreviewNotice(): React.JSX.Element {
  return (
    <ShareNotice className="min-h-40 flex-none">
      Entre no canal para ver a tela compartilhada
    </ShareNotice>
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
export function ScreenShareStage({ channelId }: { channelId: Id<'channels'> }): React.JSX.Element {
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

  // `h-full` em vez de `flex-1`: a partir do Plano 08.5-07 quem dimensiona esta
  // região é o container do `CallStage`, que muda de tamanho conforme o layout
  // do palco (ladrilhos / compartilhamento / expandido). O componente só
  // preenche o espaço que recebe.
  if (tracks.length === 0) {
    return (
      <ShareNotice className="h-full min-h-40">
        {isConnectedHere
          ? 'Ninguém está compartilhando a tela'
          : 'Entre no canal para ver a tela compartilhada'}
      </ShareNotice>
    )
  }

  return (
    <div className="h-full min-h-40 w-full flex flex-wrap items-stretch justify-center gap-3">
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
