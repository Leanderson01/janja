import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Headphones, Mic, MicOff, MonitorUp, PhoneOff, VolumeX } from 'lucide-react'
import { RoomEvent, isAudioTrack, type RemoteTrack } from 'livekit-client'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { playMuteStateChangeTone, useVoiceJoinLeaveSounds } from '@/lib/voice-sounds'
import { useSelection } from '@/state/selection-context'
import { useVoice } from '@/state/voice-context'

import { VoiceSettingsPopover } from './VoiceSettingsPopover'

import { api } from '../../../../../convex/_generated/api'

// Rodapé fixo de controles de voz (Plano 03-02). A partir da Fase 7 (Plano
// 07-03), `muted`/`deafened` deixam de ser cosméticos: cada toggle chama a
// mutation real do Plano 07-01 (`setMuted`/`setDeafened`, que já aplicam a
// semântica de "desmutar remove surdina"/"ensurdecer implica mutar" no
// servidor) e comanda a track/reprodução real do `Room` via `useVoice()`.
//
// `muted`/`deafened` locais continuam sendo `useState` — não porque são
// mock, mas porque não existe ainda (Plano 07-04) uma query pública de
// "minha linha de voiceStates" para ler a fonte da verdade do servidor sem
// tocar em `convex/` (fora do escopo de arquivos deste plano, que pertence
// ao Plano 07-02 nesta wave). Por isso, ao completar um NOVO join (transição
// de `joinedVoiceChannelId` null -> canal, ou canal -> outro canal), o
// estado local reseta para "destravado" — mesma linha de base que
// `upsertVoiceState` usa para uma linha nova. Isso não cobre o caso raro de
// reconectar a uma linha de `voiceStates` pré-existente ainda não limpa pelo
// webhook (ver 07-03-SUMMARY.md); o Plano 07-04 fecha essa lacuna quando
// adicionar a query de participantes.
//
// Plano 07-05 acrescenta o botão de engrenagem (`VoiceSettingsPopover`) e
// `setManualMute(next)` em todo caminho que muta manualmente: sem isso, um
// monitor de VAD em andamento reabriria o microfone assim que a pessoa
// voltasse a falar, ignorando o mute manual.
export function VoiceControlBar(): React.JSX.Element {
  const { joinedVoiceChannelId, setJoinedVoiceChannelId } = useSelection()
  const {
    room,
    connectionState,
    setManualMute,
    setDeafened,
    isSharing,
    startScreenShare,
    stopScreenShare
  } = useVoice()

  // Plano 07-07 (VOICE-17): observa `voiceStates` do canal conectado e toca
  // som de entrada/saída — vive aqui porque este já é o "centro de
  // controles de voz" do shell, sem criar um novo ponto de montagem.
  useVoiceJoinLeaveSounds()

  const setMutedMutation = useMutation(api.voice.setMuted)
  const setDeafenedMutation = useMutation(api.voice.setDeafened)

  const [muted, setMutedState] = useState(false)
  const [deafened, setDeafenedState] = useState(false)

  // `getChannel` (não `listChannels`) é deliberado: o canal de voz conectado
  // pode pertencer a um servidor diferente do que está selecionado agora na
  // sidebar (o usuário pode navegar para outro servidor sem sair da voz),
  // então a busca não pode depender de `selectedServerId`.
  const connectedChannel = useQuery(
    api.channels.getChannel,
    joinedVoiceChannelId ? { channelId: joinedVoiceChannelId } : 'skip'
  )

  const hasIntention = joinedVoiceChannelId !== null
  const isReady = hasIntention && connectionState === 'connected'

  // Reconciliação mínima ao (re)conectar: uma nova intenção de join sempre
  // nasce destrava (nem mutada, nem ensurdecida) — não dispara em
  // reconexões automáticas do próprio LiveKit (connectionState oscilando
  // connected -> reconnecting -> connected sem `joinedVoiceChannelId`
  // mudar), só quando o usuário de fato troca de canal de voz. Ajuste de
  // estado durante o render (não dentro de um `useEffect`) — padrão
  // recomendado pelo React para "resetar estado quando uma prop muda", sem
  // o commit extra de um efeito rodando depois do primeiro paint.
  const [syncedChannelId, setSyncedChannelId] = useState(joinedVoiceChannelId)
  if (joinedVoiceChannelId !== syncedChannelId) {
    setSyncedChannelId(joinedVoiceChannelId)
    if (joinedVoiceChannelId !== null) {
      setMutedState(false)
      setDeafenedState(false)
    }
  }

  // Ensurdecer é local/de reprodução: não existe "desabilitar playback por
  // participante" nativo no LiveKit para isso — a forma correta é silenciar
  // a reprodução de toda track de áudio remota (volume 0), reaplicando o
  // mesmo valor a qualquer track que seja assinada DEPOIS de já estar
  // ensurdecido (participante que entra depois do usuário já ensurdecido).
  useEffect(() => {
    function applyVolume(track: RemoteTrack): void {
      if (!isAudioTrack(track)) return
      track.setVolume(deafened ? 0 : 1)
    }

    room.remoteParticipants.forEach((participant) => {
      participant.audioTrackPublications.forEach((publication) => {
        if (publication.track) applyVolume(publication.track)
      })
    })

    function handleTrackSubscribed(track: RemoteTrack): void {
      applyVolume(track)
    }

    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
    return () => {
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed)
    }
  }, [deafened, room])

  async function toggleMuted(): Promise<void> {
    const next = !muted
    try {
      await setMutedMutation({ muted: next })
    } catch (err) {
      console.error('[voice] setMuted falhou', err)
      return
    }
    // Plano 07-05: sincroniza o mute manual com o VAD ANTES de tocar na
    // track — sem isso, um monitor de VAD já em andamento poderia reabrir
    // o microfone no instante seguinte se a pessoa estivesse falando.
    setManualMute(next)
    // VOICE-16: mesmo neste caminho de toggle (que na prática só
    // muta/desmuta a track já publicada com as opções do join — ver
    // `setTrackEnabled` do SDK, que reusa a track existente via
    // `track.unmute()` em vez de recriar), as três opções são passadas de
    // novo explicitamente. Nunca ficam implícitas em nenhum caminho que
    // habilita o microfone.
    await room.localParticipant.setMicrophoneEnabled(!next, {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    })
    setMutedState(next)
    // Plano 07-11 (pedido do usuário após teste em Windows): tom de
    // mute/desmute do PRÓPRIO microfone. Chamado SÓ aqui — o único lugar
    // onde a mudança de mute é uma decisão manual real (clique no botão do
    // rodapé). Nunca chamado do VAD nem do push-to-talk (`voice-context.tsx`),
    // que ligam/desligam a track a cada fala/tecla, nem do lado "ensurdecer
    // implica mutar" de `toggleDeafened` abaixo — ver justificativa em
    // `playMuteStateChangeTone` (voice-sounds.ts).
    playMuteStateChangeTone(next)
    // Desativar mute enquanto ensurdecido também desativa o ensurdecimento
    // — a mutation já aplicou essa semântica no servidor (design §8); aqui
    // só refletimos o resultado na UI e na reprodução local.
    if (!next && deafened) {
      setDeafenedState(false)
      setDeafened(false)
    }
  }

  async function toggleDeafened(): Promise<void> {
    const next = !deafened
    try {
      await setDeafenedMutation({ deafened: next })
    } catch (err) {
      console.error('[voice] setDeafened falhou', err)
      return
    }
    setDeafenedState(next)
    // Plano 07-11: espelha em `voice-context.tsx` (`deafenedRef`), para que
    // o tom de "eu saí" (disparado na transição de saída, ver
    // `voice-context.tsx`) saiba se deve ficar em silêncio — mesma
    // sincronização de `setManualMute`, mas para ensurdecer.
    setDeafened(next)
    // Ativar deafen implica mute (design §8) — a mutation já aplicou isso no
    // servidor; aqui refletimos no microfone real e no ícone.
    if (next && !muted) {
      // Mesma sincronização de VOICE-05 acima: sem isto, VAD ativo
      // reabriria o microfone na próxima fala mesmo com o usuário
      // ensurdecido (que implica mutado).
      setManualMute(true)
      await room.localParticipant.setMicrophoneEnabled(false)
      setMutedState(true)
    }
  }

  // SHARE-01/02 (Plano 08-02): um único botão de alternância. Sem
  // confirmação e sem seletor aqui — quem pergunta qual tela/janela
  // compartilhar é o `ScreenSharePicker` (Plano 08-04), disparado pelo
  // processo main.
  //
  // A qualidade ("Fluida"/"Nítida", SHARE-08) NÃO tem controle neste rodapé:
  // mora no popover de configurações de voz, o botão de engrenagem logo ao
  // lado (Plano 08-05). Motivo em `VoiceSettingsPopover.tsx` — a coluna é
  // fixa em 240px e não sobra largura para dois botões de texto.
  //
  // `voiceStates.sharing` no Convex também não é escrito daqui: quem
  // escreve é o listener de `LocalTrackPublished`/`LocalTrackUnpublished`
  // em `voice-context.tsx`, porque a track publicada é o fato, e o clique é
  // só a intenção.
  //
  // Não é `async`: `startScreenShare`/`stopScreenShare` nunca rejeitam (todo
  // erro, cancelamento incluso, já vira log dentro delas), e `isSharing` vem
  // do evento de publicação real do `Room`, não de um estado otimista daqui
  // — não há nada para aguardar neste componente.
  function toggleScreenShare(): void {
    void (isSharing ? stopScreenShare() : startScreenShare())
  }

  function leaveVoiceChannel(): void {
    setJoinedVoiceChannelId(null)
  }

  const isReconnecting =
    connectionState === 'reconnecting' || connectionState === 'signalReconnecting'
  const channelName = connectedChannel?.name

  return (
    <div className="flex-none h-14 border-t border-border bg-secondary px-2 flex items-center gap-2">
      <div className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
        {!hasIntention ? (
          <span>Não conectado a nenhum canal de voz</span>
        ) : isReconnecting ? (
          <span className="text-amber-500 font-medium">Reconectando...</span>
        ) : connectionState === 'connected' ? (
          <span className="text-foreground font-medium">Conectado a {channelName}</span>
        ) : (
          <span className="text-foreground font-medium">
            Conectando a {channelName ?? '...'}...
          </span>
        )}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!isReady}
            aria-pressed={muted}
            onClick={() => void toggleMuted()}
          >
            {muted ? <MicOff className="text-destructive" /> : <Mic />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{muted ? 'Ativar microfone' : 'Silenciar microfone'}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!isReady}
            aria-pressed={deafened}
            onClick={() => void toggleDeafened()}
          >
            {deafened ? <VolumeX className="text-destructive" /> : <Headphones />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{deafened ? 'Desativar surdina' : 'Ensurdecer'}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!isReady}
            aria-pressed={isSharing}
            aria-label={isSharing ? 'Parar compartilhamento de tela' : 'Compartilhar tela'}
            onClick={toggleScreenShare}
          >
            <MonitorUp className={isSharing ? 'text-green-500' : undefined} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isSharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
        </TooltipContent>
      </Tooltip>

      {/* Plano 07-09: sempre renderizado, não só com `hasIntention` — o testador de
          microfone (VOICE-21) precisa ser alcançável sem nenhum canal conectado. As
          seções que dependem de um `Room` real continuam gated por
          `hasVoiceIntention` dentro do próprio popover. */}
      <VoiceSettingsPopover disabled={hasIntention && !isReady} hasVoiceIntention={hasIntention} />

      {hasIntention && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={leaveVoiceChannel}
              aria-label="Sair do canal de voz"
            >
              <PhoneOff className="text-destructive" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Desconectar</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
