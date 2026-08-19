import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAction, useMutation } from 'convex/react'
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  isAudioTrack,
  type RemoteTrack
} from 'livekit-client'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'

import { createVadMonitor, type VadMonitor } from '../lib/vad'
import { loadVoicePreferences, type VoicePreferences } from '../lib/voice-preferences'

import { useSelection } from './selection-context'

// VOICE-16: cancelamento de eco, supressão de ruído e ganho automático
// nunca vêm ligados por padrão — sempre explícitos em toda chamada que
// habilita o microfone, ligado ou desligado (Plano 07-03 §Decisions #3).
// Centralizado aqui porque o Plano 07-05 introduz um segundo call-site
// (VAD ligando/desligando a track) além do join original.
const AUDIO_CAPTURE_OPTIONS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
}

// VOICE-01/03/06/07: ponte real entre a INTENÇÃO de estar num canal de voz
// (`joinedVoiceChannelId`, que já mora em SelectionContext desde a Fase 3) e
// o ciclo de vida do `Room` do LiveKit. Este provider nunca guarda a
// intenção — só observa e comanda os efeitos colaterais: assinar token via
// `joinVoiceChannel`, conectar/desconectar o `Room`, publicar o microfone
// com as opções de captura corretas.
//
// `connectionState` usa exatamente os 5 valores do enum `ConnectionState` do
// `livekit-client` (07-RESEARCH.md §3) — nenhuma nomenclatura própria.
export type VoiceConnectionState =
  'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'signalReconnecting'

export type VoiceContextValue = {
  room: Room
  connectionState: VoiceConnectionState
  /**
   * Relê `loadVoicePreferences()` e reconfigura o VAD ativo (para, inicia
   * ou só ajusta o limiar) sem reconectar à sala. Chamado pelo painel de
   * configurações (Plano 07-05, Task 3) sempre que o usuário muda o modo
   * ou arrasta o slider de limiar; não faz nada se não há canal conectado.
   */
  applyVoicePreferences: () => void
  /**
   * Sincroniza o mute MANUAL (botão do rodapé) com o VAD: enquanto
   * `muted` for `true`, o monitor de VAD não reabre o microfone ao
   * detectar fala — sem isto, mutar manualmente com VAD ativo seria
   * revertido no próximo momento em que a pessoa falasse. Chamado por
   * `VoiceControlBar` a cada toggle de mute/deafen, nunca pelo próprio VAD.
   */
  setManualMute: (muted: boolean) => void
}

const VoiceContext = createContext<VoiceContextValue | undefined>(undefined)

export function VoiceProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { joinedVoiceChannelId, setJoinedVoiceChannelId } = useSelection()
  const joinVoiceChannel = useAction(api.voiceToken.joinVoiceChannel)
  const leaveVoiceChannelMutation = useMutation(api.voice.leaveVoiceChannel)

  // Um único `Room` para a vida inteira do provider (= vida do app montado).
  // `useState` com inicializador preguiçoso garante uma única instância
  // estável sem acessar `.current` de uma ref durante o render — não
  // recriamos a instância a cada troca de canal, `room.connect()` /
  // `room.disconnect()` são chamados repetidamente sobre o mesmo objeto, que
  // é o padrão do SDK.
  const [room] = useState(() => new Room())

  const [connectionState, setConnectionState] = useState<VoiceConnectionState>('disconnected')

  // Canal ao qual o `Room` está de fato conectado agora (não a intenção).
  // Usado para: (1) decidir se uma transição de `joinedVoiceChannelId`
  // precisa de leave antes de join, e (2) distinguir um `Disconnected` que
  // nós mesmos causamos (já zeramos esta ref antes de chamar
  // `room.disconnect()`) de um `Disconnected` que o próprio LiveKit iniciou
  // (sala fechada, expulsão, reconexão esgotada) — só o segundo caso deve
  // devolver a intenção para `null`. Só é lida/escrita dentro de efeitos e
  // seus callbacks, nunca durante o render.
  const activeChannelRef = useRef<Id<'channels'> | null>(null)

  // Monitor de VAD ativo (Plano 07-05), ou `null` quando o modo atual é
  // 'ptt' ou não há canal conectado. Nunca reaproveitado de uma sessão
  // anterior sobre uma track nova — sempre parado explicitamente antes de
  // um novo `start`.
  const vadMonitorRef = useRef<VadMonitor | null>(null)

  // Espelha o mute MANUAL (botão do rodapé) — ver `setManualMute` no valor
  // do contexto. Resetado a cada novo join bem-sucedido (nova intenção =
  // sempre destravado, mesma linha de base do resto da reconciliação
  // mínima documentada no Plano 07-03).
  const manualMuteRef = useRef(false)

  function stopVadMonitor(): void {
    vadMonitorRef.current?.stop()
    vadMonitorRef.current = null
  }

  // Liga o VAD sobre a `MediaStreamTrack` do microfone publicado agora. Se
  // não houver track de microfone publicada (ex.: chamado fora de ordem),
  // não faz nada — quem chama é responsável por só invocar isto depois de
  // `setMicrophoneEnabled` já ter resolvido.
  function startVadMonitor(prefs: VoicePreferences): void {
    const micPublication = room.localParticipant.getTrackPublication(Track.Source.Microphone)
    const mediaStreamTrack = micPublication?.track?.mediaStreamTrack
    if (!mediaStreamTrack) return

    vadMonitorRef.current = createVadMonitor(mediaStreamTrack, {
      threshold: prefs.vadThreshold,
      onSpeakingChange: (speaking) => {
        // Mute manual sempre vence: se o usuário mutou pelo botão do
        // rodapé, o VAD detectar fala não deve reabrir o microfone —
        // só desligar continua permitido (harmless, já estaria desligado).
        if (speaking && manualMuteRef.current) return
        // Transmissão automática do VAD — nunca passa pela mutation
        // `setMuted` do Convex, que reflete só o mute manual do botão
        // (07-05-PLAN.md Task 2). Comanda a track diretamente.
        void room.localParticipant.setMicrophoneEnabled(speaking, AUDIO_CAPTURE_OPTIONS)
      }
    })
  }

  // Relê a preferência salva e reconfigura o VAD ativo sem reconectar à
  // sala — chamado pelo painel de configurações (Task 3) e internamente ao
  // completar um novo join (abaixo). Não faz nada se não há canal
  // conectado agora.
  function applyVoicePreferences(): void {
    if (activeChannelRef.current === null) return

    const prefs = loadVoicePreferences()
    stopVadMonitor()

    if (prefs.mode === 'vad') {
      // A track existe mas começa desabilitada — o VAD é quem liga/desliga
      // a partir daqui, nunca o usuário diretamente enquanto este modo
      // estiver ativo.
      void room.localParticipant.setMicrophoneEnabled(false, AUDIO_CAPTURE_OPTIONS)
      startVadMonitor(prefs)
    }
    // modo 'ptt': não inicia o VAD — o Plano 07-06 assume o controle da
    // track nesse modo.
  }

  function setManualMute(muted: boolean): void {
    manualMuteRef.current = muted
  }

  // Elementos `<audio>` de participantes remotos: TODO elemento precisa ser
  // criado via `track.attach()` do próprio SDK (nunca `new Audio()` manual)
  // — é a única forma de `switchActiveDevice('audiooutput', ...)` (Task 3)
  // alcançar essa track depois (07-RESEARCH.md §3, lacuna de doc). Sem isto
  // o áudio remoto nunca toca: `RemoteAudioTrack.setVolume`/`setSinkId` só
  // afetam elementos já anexados via `attach()`, e nenhum plano anterior
  // desta fase chamava `attach()` — VoiceControlBar só ajustava volume de
  // tracks que nunca chegavam a tocar.
  useEffect(() => {
    const container = document.createElement('div')
    container.style.display = 'none'
    container.setAttribute('data-voice-remote-audio', 'true')
    document.body.appendChild(container)

    function attachAudioTrack(track: RemoteTrack): void {
      if (!isAudioTrack(track)) return
      const element = track.attach()
      container.appendChild(element)
    }

    function detachAudioTrack(track: RemoteTrack): void {
      if (!isAudioTrack(track)) return
      track.detach().forEach((el) => el.remove())
    }

    // Higiene para hot-reload/remontagem: cobre participantes cujas tracks
    // já estavam inscritas antes deste efeito registrar os listeners.
    room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        if (publication.track) attachAudioTrack(publication.track)
      })
    })

    room.on(RoomEvent.TrackSubscribed, attachAudioTrack)
    room.on(RoomEvent.TrackUnsubscribed, detachAudioTrack)

    return () => {
      room.off(RoomEvent.TrackSubscribed, attachAudioTrack)
      room.off(RoomEvent.TrackUnsubscribed, detachAudioTrack)
      container.remove()
    }
  }, [room])

  // Listeners do Room: registrados uma única vez, na vida do `Room`.
  // `setJoinedVoiceChannelId` é o setter cru de um `useState` de
  // SelectionProvider — estável por toda a vida do componente, não precisa
  // de indireção via ref para ser usado num efeito com deps `[]`.
  useEffect(() => {
    function handleConnectionStateChanged(state: ConnectionState): void {
      setConnectionState(state as VoiceConnectionState)
    }

    function handleDisconnected(): void {
      // Se `activeChannelRef` já está null, fomos nós que chamamos
      // `room.disconnect()` de propósito (ver a fila de transições abaixo)
      // — a intenção já reflete a realidade, nada a fazer. Se ainda aponta
      // para um canal, o Room caiu sozinho (sala fechada, expulsão,
      // reconexão esgotada) e a UI não pode continuar mostrando "conectado"
      // a um canal do qual o app já caiu.
      if (activeChannelRef.current !== null) {
        activeChannelRef.current = null
        stopVadMonitor()
        setJoinedVoiceChannelId(null)
      }
    }

    room.on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged)
    room.on(RoomEvent.Disconnected, handleDisconnected)

    return () => {
      room.off(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged)
      room.off(RoomEvent.Disconnected, handleDisconnected)
      // Higiene de hot-reload/fechamento do app — best-effort, não é o
      // mecanismo principal de saída (isso é o webhook do Plano 07-02).
      stopVadMonitor()
      void room.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fila serializada de transições: cada mudança de `joinedVoiceChannelId`
  // encadeia um passo na mesma promise, garantindo que um leave anterior
  // sempre termine antes do próximo join começar — mesmo que o usuário troque
  // de canal de voz rapidamente (channelA -> channelB sem passar por null).
  const transitionChainRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    const target = joinedVoiceChannelId

    transitionChainRef.current = transitionChainRef.current
      .catch(() => {
        // Um passo anterior já logou seu próprio erro; só garante que a
        // cadeia não trava para sempre por causa de uma rejeição antiga.
      })
      .then(async () => {
        if (activeChannelRef.current === target) return

        if (activeChannelRef.current !== null) {
          activeChannelRef.current = null
          // Parar o monitor de VAD da sessão anterior antes de desconectar
          // — nunca reaproveitado sobre a track da próxima sessão, sempre
          // reiniciado do zero em cada nova conexão (07-05-PLAN.md Task 2).
          stopVadMonitor()
          try {
            await leaveVoiceChannelMutation({})
          } catch (err) {
            console.error('[voice] leaveVoiceChannel falhou', err)
          }
          try {
            await room.disconnect()
          } catch (err) {
            console.error('[voice] room.disconnect falhou', err)
          }
        }

        if (target !== null) {
          try {
            const { token, url } = await joinVoiceChannel({ channelId: target })
            await room.connect(url, token)
            // VOICE-16: cancelamento de eco, supressão de ruído e ganho
            // automático nunca vêm ligados por padrão — precisam ser
            // setados explicitamente aqui, sempre.
            await room.localParticipant.setMicrophoneEnabled(true, AUDIO_CAPTURE_OPTIONS)
            activeChannelRef.current = target
            // Nova intenção de join = sempre destravado (mesma linha de
            // base da reconciliação mínima do Plano 07-03).
            manualMuteRef.current = false
            // Aplica a preferência de transmissão salva (VAD por padrão) à
            // track recém-publicada. Em modo VAD, a track existe mas
            // começa desabilitada — o VAD é quem liga/desliga a partir
            // daqui (07-05-PLAN.md Task 2).
            applyVoicePreferences()
          } catch (err) {
            console.error('[voice] falha ao entrar no canal de voz', err)
            // A intenção não pôde ser cumprida — devolve a UI para o estado
            // real (não conectado) em vez de ficar presa "tentando".
            setJoinedVoiceChannelId(null)
          }
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinedVoiceChannelId])

  const value: VoiceContextValue = {
    room,
    connectionState,
    applyVoicePreferences,
    setManualMute
  }

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}

export function useVoice(): VoiceContextValue {
  const context = useContext(VoiceContext)
  if (!context) {
    throw new Error('useVoice deve ser usado dentro de um VoiceProvider')
  }
  return context
}
