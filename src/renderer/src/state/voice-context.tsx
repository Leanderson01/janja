import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAction, useMutation } from 'convex/react'
import {
  ConnectionQuality,
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  isAudioTrack,
  type Participant,
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
   * Identities (= `users._id` do Convex, ver 07-RESEARCH.md §6) de quem
   * está falando agora, com debounce de ~300ms na remoção — nunca pisca
   * em micropausas de respiração (VOICE-08). Vazio quando desconectado.
   * Dado 100% efêmero do LiveKit (`ActiveSpeakersChanged`), nunca lido de
   * `voiceStates` — só é significativo dentro do canal ao qual este `Room`
   * está de fato conectado (`joinedVoiceChannelId`); quem consome isto
   * para outro canal está lendo dado fora de contexto.
   */
  speakingUserIds: Set<string>
  /**
   * Qualidade de conexão por identity (`users._id`), incluindo a própria
   * (`room.localParticipant.identity`). Vazio quando desconectado. Mesma
   * ressalva de `speakingUserIds`: só válido para o canal conectado agora.
   */
  connectionQualities: Map<string, ConnectionQuality>
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

  // VOICE-08 (Plano 07-04): quem está falando agora, com debounce de
  // remoção — dado 100% efêmero do LiveKit (`ActiveSpeakersChanged`),
  // nunca persistido em `voiceStates`. `speakingSetRef` é a fonte de
  // verdade síncrona lida/escrita dentro do handler do evento;
  // `speakingUserIds` (estado) é só o espelho que a UI lê. Sem esse par
  // ref+state o debounce exigiria comparar o estado anterior de dentro de
  // um `setState` funcional, o que complica cancelar timeouts por
  // identity de forma direta.
  const speakingSetRef = useRef<Set<string>>(new Set())
  const speakingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [speakingUserIds, setSpeakingUserIds] = useState<Set<string>>(new Set())

  // VOICE-15: qualidade de conexão por participante (incluindo a própria,
  // via `room.localParticipant`) — também 100% efêmero do LiveKit
  // (`ConnectionQualityChanged`), nunca persistido.
  const [connectionQualities, setConnectionQualities] = useState<Map<string, ConnectionQuality>>(
    new Map()
  )

  // Tempo de espera antes de remover alguém do conjunto de quem fala,
  // depois que o LiveKit para de reportá-lo em `ActiveSpeakersChanged` —
  // sem isto o anel de fala liga/desliga a cada micropausa de respiração
  // (07-RESEARCH.md, FEATURES.md linha do indicador de fala).
  const SPEAKING_DEBOUNCE_MS = 300

  /** Publica `speakingSetRef.current` (a fonte de verdade síncrona) como um
   * novo `Set` no estado React, disparando re-render da UI que o consome. */
  function commitSpeakingUserIds(): void {
    setSpeakingUserIds(new Set(speakingSetRef.current))
  }

  /** Zera fala e qualidade de conexão — chamado sempre que o `Room` deixa
   * de estar conectado (saída própria ou queda), nunca deixando dado de
   * uma sessão de call anterior vazar pra próxima. */
  function clearSpeakingAndQuality(): void {
    speakingTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout))
    speakingTimeoutsRef.current.clear()
    speakingSetRef.current = new Set()
    setSpeakingUserIds(new Set())
    setConnectionQualities(new Map())
  }

  function handleActiveSpeakersChanged(speakers: Participant[]): void {
    const speakingNow = new Set(speakers.map((p) => p.identity))

    // Quem fala agora (continuando ou começando): presença imediata no
    // set, cancelando qualquer remoção pendente por micropausa anterior.
    speakingNow.forEach((identity) => {
      const pendingTimeout = speakingTimeoutsRef.current.get(identity)
      if (pendingTimeout) {
        clearTimeout(pendingTimeout)
        speakingTimeoutsRef.current.delete(identity)
      }
      speakingSetRef.current.add(identity)
    })

    // Quem estava no set mas não está mais entre os speakers agora: não
    // remove na hora — agenda a remoção com debounce, cancelável se a
    // pessoa voltar a falar antes do timeout disparar.
    speakingSetRef.current.forEach((identity) => {
      if (speakingNow.has(identity)) return
      if (speakingTimeoutsRef.current.has(identity)) return
      const timeout = setTimeout(() => {
        speakingTimeoutsRef.current.delete(identity)
        speakingSetRef.current.delete(identity)
        commitSpeakingUserIds()
      }, SPEAKING_DEBOUNCE_MS)
      speakingTimeoutsRef.current.set(identity, timeout)
    })

    commitSpeakingUserIds()
  }

  function handleConnectionQualityChanged(
    quality: ConnectionQuality,
    participant?: Participant
  ): void {
    const identity = participant?.identity ?? room.localParticipant.identity
    setConnectionQualities((prev) => {
      const next = new Map(prev)
      next.set(identity, quality)
      return next
    })
  }

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
      // Fala e qualidade de conexão nunca sobrevivem a uma desconexão —
      // sempre zeradas aqui, independente de quem causou (nós ou o
      // LiveKit), nunca deixando dado de uma call anterior vazar pra
      // próxima.
      clearSpeakingAndQuality()

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
    room.on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakersChanged)
    room.on(RoomEvent.ConnectionQualityChanged, handleConnectionQualityChanged)

    return () => {
      room.off(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged)
      room.off(RoomEvent.Disconnected, handleDisconnected)
      room.off(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakersChanged)
      room.off(RoomEvent.ConnectionQualityChanged, handleConnectionQualityChanged)
      // Higiene de hot-reload/fechamento do app — best-effort, não é o
      // mecanismo principal de saída (isso é o webhook do Plano 07-02).
      clearSpeakingAndQuality()
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

  // 07-10: alvo já RECLAMADO por uma invocação deste efeito, atualizado de
  // forma SÍNCRONA — antes de qualquer `await`, antes até de enfileirar
  // qualquer passo na `transitionChainRef`. `activeChannelRef` só reflete a
  // realidade DEPOIS que um join/leave inteiro termina, então não serve
  // pra distinguir "já existe alguém cuidando deste alvo agora" de "ninguém
  // ainda tentou" — uma segunda invocação síncrona para o MESMO alvo (o
  // double-invoke de desenvolvimento do StrictMode chama o corpo deste
  // efeito duas vezes, de trás pra frente, para o mesmo render) passaria
  // pela guarda de `activeChannelRef` e enfileiraria um segundo passo que,
  // se o primeiro falhar ou for interrompido por qualquer razão antes de
  // setar `activeChannelRef`, reconecta do zero — foi exatamente isso que
  // produziu dois `joinVoiceChannel`/duas conexões reais ao mesmo canal
  // num teste com dois usuários (mesma identity, o SFU derruba uma das
  // duas). `lastEnqueuedTargetRef` fecha essa janela: só a invocação que
  // efetivamente reivindica um alvo novo enfileira trabalho para ele;
  // qualquer invocação repetida para o alvo já reclamado é um no-op
  // imediato, sem nem entrar na fila.
  const lastEnqueuedTargetRef = useRef<Id<'channels'> | null>(null)

  useEffect(() => {
    const target = joinedVoiceChannelId

    // Reivindicação síncrona: se uma invocação anterior (mesmo render,
    // StrictMode double-invoke, ou qualquer outro disparo espúrio sem o
    // alvo ter de fato mudado) já reclamou este exato alvo, não há nada
    // novo a fazer — nem vale a pena enfileirar um passo que só vai
    // confirmar isso mais tarde. Um alvo DIFERENTE sempre reclama e
    // enfileira normalmente, mesmo com uma transição anterior ainda em
    // andamento (troca rápida de canal continua funcionando: a fila
    // serializada abaixo garante que o passo mais novo roda depois do
    // anterior terminar, e termina conectado ao alvo mais recente).
    if (lastEnqueuedTargetRef.current === target) return
    lastEnqueuedTargetRef.current = target

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
            // Trava defensiva contra conexão duplicada (segunda camada).
            //
            // Um testador produziu um log com DUAS conexões ao LiveKit numa única
            // entrada: dois tokens distintos, dois `signal connecting`, dois
            // `connected to LiveKit Server` — e um só `publishing track`. Como as duas
            // usam a mesma identidade, o SFU derruba a mais antiga, e o áudio funciona
            // ou não conforme qual sobreviveu. O sintoma relatado foi "do nada começou
            // a funcionar", assinatura de corrida.
            //
            // A causa raiz (uma segunda invocação deste efeito para o mesmo alvo
            // reconectando do zero sempre que a primeira não chegava a marcar
            // `activeChannelRef`, StrictMode double-invoke incluso) está fechada por
            // `lastEnqueuedTargetRef` acima, antes mesmo de qualquer passo ser
            // enfileirado. Esta checagem continua aqui como segunda camada, para
            // qualquer outra via que chame `room.connect()` enquanto uma conexão já
            // está ativa/em andamento — `room.state` é a verdade do SDK sobre a
            // conexão, não uma suposição nossa sobre o que a fila garantiu.
            if (room.state !== ConnectionState.Disconnected) {
              console.warn(
                '[voice] conexão já em andamento ou ativa (%s) — ignorando join duplicado',
                room.state
              )
              activeChannelRef.current = target
              return
            }

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
            // Libera a reivindicação deste alvo em `lastEnqueuedTargetRef`
            // SE a falha aconteceu antes de `activeChannelRef` ser marcado
            // (o caminho normal, já que ele só é setado depois que
            // `room.connect`/`setMicrophoneEnabled` resolvem com sucesso,
            // logo acima). Sem isto, uma nova tentativa para este MESMO
            // canal (usuário clicando de novo) seria descartada como
            // duplicada pela guarda síncrona do efeito, deixando quem
            // tentou entrar permanentemente incapaz de se conectar. Se por
            // algum motivo `activeChannelRef` já foi marcado com sucesso
            // antes de um erro tardio (ex.: `applyVoicePreferences`), não
            // mexe aqui — a reivindicação continua correta e não deve ser
            // solta.
            if (activeChannelRef.current !== target) {
              lastEnqueuedTargetRef.current = null
            }
          }
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinedVoiceChannelId])

  const value: VoiceContextValue = {
    room,
    connectionState,
    speakingUserIds,
    connectionQualities,
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
