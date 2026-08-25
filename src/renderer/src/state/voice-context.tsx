import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useAction, useMutation } from 'convex/react'
import {
  ConnectionQuality,
  ConnectionState,
  Room,
  RoomEvent,
  ScreenSharePresets,
  Track,
  isAudioTrack,
  isVideoTrack,
  type LocalTrackPublication,
  type LocalVideoTrack,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteVideoTrack,
  type ScreenShareCaptureOptions,
  type VideoPreset
} from 'livekit-client'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'

import { createVadMonitor, type VadMonitor } from '../lib/vad'
import { playSelfLeaveTone } from '../lib/voice-sounds'
import { loadScreenSharePreferences, type ScreenShareQuality } from '../lib/screenshare-preferences'
import {
  addScreenShareEntry,
  clearScreenShareEntries,
  removeScreenShareEntriesOfParticipant,
  removeScreenShareEntryBySid,
  type ScreenShareEntry
} from '../lib/screenshare-tracks'
import { loadVoicePreferences, type VoicePreferences } from '../lib/voice-preferences'
import {
  DEFAULT_PARTICIPANT_VOLUME,
  effectiveVolume,
  loadParticipantVolumes,
  saveParticipantVolumes,
  type ParticipantVolumes
} from '../lib/participant-volumes'

import { pushToTalk } from '@platform/ptt'
import { screenShare } from '@platform/screenshare'

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

// SHARE-08 (Plano 08-05): os dois níveis de qualidade oferecidos ao usuário,
// mapeados conforme `08-RESEARCH.md §5`. Dois níveis nomeados, nunca sliders
// crus de bitrate/fps — quem escolhe é uma pessoa decidindo entre "quero que
// não trave" e "quero conseguir ler o texto", não um engenheiro de vídeo.
//
// `contentHint` acompanha o preset de propósito: é a dica que o encoder do
// Chromium usa para decidir o que sacrificar quando a banda aperta.
// 'motion' sacrifica nitidez para manter fps; 'detail' faz o inverso.
// Escolher `h720fps30` com hint 'detail' pediria ao encoder exatamente o
// contrário do que o preset promete.
//
// `videoCodec` fica no default (`vp8`) de propósito — `08-RESEARCH.md §5`:
// é o codec amplamente suportado e não há motivo para desviar nesta fase.
const QUALITY_PRESETS: Record<
  ScreenShareQuality,
  { preset: VideoPreset; contentHint: NonNullable<ScreenShareCaptureOptions['contentHint']> }
> = {
  // 1280x720 @ 30fps, ~2.0 Mbps
  fluida: { preset: ScreenSharePresets.h720fps30, contentHint: 'motion' },
  // 1920x1080 @ 15fps, ~2.5 Mbps
  nitida: { preset: ScreenSharePresets.h1080fps15, contentHint: 'detail' }
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

/**
 * SHARE-02 (Plano 08-06): uma tela sendo compartilhada AGORA no `Room`
 * conectado — a própria (`isLocal: true`) ou a de outro participante. A track
 * é entregue crua para quem renderiza: o elemento `<video>` tem que sair de
 * `track.attach()`, nunca de um `<video src>` montado à mão (08-RESEARCH.md
 * §6).
 */
export type ScreenShareTrack = ScreenShareEntry<LocalVideoTrack | RemoteVideoTrack>

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
  /**
   * Plano 07-11: espelha o estado de ENSURDECER (botão do rodapé) para que
   * o tom de "eu saí" (disparado direto daqui, na transição de saída, não
   * mais via diff — ver `voice-sounds.ts`/`playSelfLeaveTone`) saiba se
   * deve tocar. Mesma justificativa de `setManualMute`: quem ensurdeceu a
   * si mesmo não quer ouvir som de notificação nenhum, nem o de sua
   * própria saída. Chamado por `VoiceControlBar` a cada toggle de
   * ensurdecer/desensurdecer (incluindo o desensurdecimento implícito de
   * desmutar), nunca por nenhuma outra via.
   */
  setDeafened: (deafened: boolean) => void
  /**
   * Plano 08.5-11: ENSURDECIDO agora também é ESTADO, não só `deafenedRef`.
   * O motivo é técnico e não cosmético: o efeito que aplica volume nas tracks
   * remotas precisa de uma dependência REATIVA para reexecutar, e `ref` não
   * reexecuta efeito nenhum. O ref continua existindo (é lido de dentro de
   * callbacks assíncronos por `voice-sounds`), como espelho síncrono deste
   * estado — `setDeafened` escreve nos dois.
   *
   * Quem renderiza o botão do rodapé lê daqui, não de um `useState` próprio:
   * até o Plano 08.5-11 o `VoiceControlBar` tinha uma cópia local, e cópia de
   * estado que também mora aqui é divergência esperando para acontecer.
   */
  deafened: boolean
  /**
   * VOICE-18 (Plano 08.5-11): volume (0..2) e "silenciado só para mim" por
   * `identity` (= `users._id`). Entrada ausente = volume normal. Estado de
   * MÁQUINA, persistido em `localStorage` — ver `lib/participant-volumes.ts`.
   */
  participantVolumes: ParticipantVolumes
  /**
   * Ajusta o volume de UMA pessoa, para mim, nesta máquina. `volume` é a
   * escala 0..2 do módulo de preferências (1 = normal), não porcentagem.
   * Persiste na hora e é aplicado imediatamente às tracks já inscritas.
   */
  setParticipantVolume: (identity: string, volume: number) => void
  /**
   * Silencia/dessilencia UMA pessoa, só para mim. NÃO é moderação: não muta
   * ninguém para os outros participantes (isso não existe neste app), e não é
   * ensurdecer (que é todo mundo). Persiste na hora.
   */
  toggleParticipantSilenced: (identity: string) => void
  /**
   * SHARE-02 (Plano 08-02): a tela está sendo compartilhada AGORA. Derivado
   * de `LocalTrackPublished`/`LocalTrackUnpublished` do próprio `Room` —
   * nunca de um `useState` setado otimisticamente por quem clicou no botão.
   * A diferença importa: entre o clique e a publicação existe o handler do
   * processo main, o seletor do SO e a permissão do usuário, e qualquer um
   * dos três pode terminar em nada (cancelamento). Quem observa a publicação
   * real nunca mostra "compartilhando" para um compartilhamento que não
   * existe.
   */
  isSharing: boolean
  /**
   * SHARE-02/SHARE-06 (Plano 08-06): telas sendo compartilhadas AGORA no
   * `Room` conectado — a própria e as dos outros, na ordem em que
   * apareceram. Dado 100% efêmero do LiveKit, com a mesma ressalva de
   * `speakingUserIds`/`connectionQualities`: só é significativo para o canal
   * ao qual este `Room` está de fato conectado. Quem visualiza outro canal
   * sem entrar nele não tem — e não pode ter — nenhuma track aqui.
   *
   * Vazio em toda desconexão, e sem a entrada de quem caiu assim que o
   * `Room` reporta a queda: é essa lista que faz a região de vídeo sumir
   * sozinha, e um `<video>` que sobrevive a ela é exatamente o frame
   * congelado que a fase decidiu não aceitar.
   */
  screenShareTracks: ScreenShareTrack[]
  /**
   * Publica tela + áudio de sistema no canal de voz conectado. Não lança:
   * cancelamento pelo usuário e falha de captura viram log, com `isSharing`
   * permanecendo `false` (a Promise de `getDisplayMedia` rejeita nesses
   * casos — o handler do processo main garante que ela nunca fica pendurada,
   * ver `src/main/screenshare.ts`).
   *
   * A fonte (tela ou janela) é escolhida pelo usuário no seletor do Plano
   * 08-04, servido pelo processo main. A QUALIDADE vem da preferência local
   * salva (`screenshare-preferences.ts`, Plano 08-05), relida a cada
   * chamada — quem muda o toggle no meio de um compartilhamento só afeta o
   * próximo, nunca o que já está no ar.
   */
  startScreenShare: () => Promise<void>
  /**
   * Para o compartilhamento. O SDK despublica as DUAS tracks (vídeo e áudio
   * de sistema) por conta própria — não gerenciar isso à mão aqui
   * (08-RESEARCH.md §4).
   */
  stopScreenShare: () => Promise<void>
  /**
   * Track de ANÁLISE do VAD: o clone vivo da `MediaStreamTrack` publicada
   * que o monitor de detecção de voz escuta, ou `null` quando não há VAD
   * ativo (modo 'ptt', sem canal conectado, ou falha de setup).
   *
   * Exposta para quem precisa MEDIR nível de áudio sem ser cego pelo mute:
   * a track publicada fica com `enabled = false` sempre que o VAD (ou o
   * botão de mute do rodapé) fecha o microfone, e track desabilitada
   * entrega silêncio digital ao Web Audio — um medidor ligado nela marca
   * zero permanente.
   *
   * Quem consome **não pode** chamar `.stop()` nesta track: o dono é o
   * provider, e pará-la mata o VAD da sessão inteira. Clone antes, se
   * precisar de posse.
   */
  getVadAnalysisTrack: () => MediaStreamTrack | null
}

const VoiceContext = createContext<VoiceContextValue | undefined>(undefined)

export function VoiceProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { joinedVoiceChannelId, setJoinedVoiceChannelId } = useSelection()
  const joinVoiceChannel = useAction(api.voiceToken.joinVoiceChannel)
  const leaveVoiceChannelMutation = useMutation(api.voice.leaveVoiceChannel)
  // SHARE-05 (Plano 08-05): espelha no Convex o que o LiveKit acabou de
  // publicar/despublicar. `useMutation` devolve uma referência memoizada por
  // `[cliente convex, nome da function]` (convex/react), então é seguro
  // fechar sobre ela no efeito de listeners com deps `[]` logo abaixo —
  // mesma premissa que `leaveVoiceChannelMutation` já usa na fila de
  // transições.
  const setSharingMutation = useMutation(api.voice.setSharing)

  // Um único `Room` para a vida inteira do provider (= vida do app montado).
  // `useState` com inicializador preguiçoso garante uma única instância
  // estável sem acessar `.current` de uma ref durante o render — não
  // recriamos a instância a cada troca de canal, `room.connect()` /
  // `room.disconnect()` são chamados repetidamente sobre o mesmo objeto, que
  // é o padrão do SDK.
  const [room] = useState(() => new Room())

  const [connectionState, setConnectionState] = useState<VoiceConnectionState>('disconnected')

  // Ver `isSharing` no valor do contexto: espelho do que o `Room` de fato
  // publicou, nunca da intenção de quem clicou.
  const [isSharing, setIsSharing] = useState(false)

  // Ver `screenShareTracks` no valor do contexto. Estado (não ref) porque a
  // UI renderiza diretamente a partir dele — cada evento do `Room` que muda
  // a lista tem que virar re-render, senão o vídeo aparece/some com atraso
  // arbitrário. A reconciliação em si mora em `lib/screenshare-tracks.ts`,
  // pura e testada.
  const [screenShareTracks, setScreenShareTracks] = useState<ScreenShareTrack[]>([])

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

  // Track de ANÁLISE do VAD: um `clone()` da `MediaStreamTrack` publicada,
  // que NUNCA é publicado (não passa por `setMicrophoneEnabled`,
  // `publishTrack` nem `switchActiveDevice` — só por `createVadMonitor`,
  // que é Web Audio puro e não liga nada ao `destination`).
  //
  // Existe exatamente porque o LiveKit muta fazendo
  // `_mediaStreamTrack.enabled = false` na track publicada
  // (`LocalTrack.setTrackMuted`, livekit-client 2.22) — e track com
  // `enabled = false` entrega SILÊNCIO DIGITAL ao Web Audio, não "menos
  // volume". Analisar a própria track publicada, como se fazia antes,
  // criava um deadlock permanente: microfone fechado pelo VAD → RMS ≈ 0 →
  // limiar nunca cruzado → microfone nunca reabre. O clone compartilha a
  // MESMA fonte de captura (mesmo dispositivo, mesmo getUserMedia, mesmo
  // eco/ruído/ganho de `AUDIO_CAPTURE_OPTIONS`), mas tem `enabled` próprio
  // e independente — continua entregando áudio real com a publicação
  // mutada.
  const vadAnalysisTrackRef = useRef<MediaStreamTrack | null>(null)

  // Geração do VAD, incrementada por todo `stopVadMonitor()`. Serve para
  // invalidar um `applyVoicePreferencesAsync` em voo: como ele agora tem
  // `await`, um leave/troca de canal/troca de modo pode acontecer no meio
  // do setup — quem passou por um `await` compara a geração que capturou
  // com a atual e aborta se mudou, em vez de mutar um microfone que já
  // pertence a outra sessão.
  const vadGenerationRef = useRef(0)

  // Espelha o mute MANUAL (botão do rodapé) — ver `setManualMute` no valor
  // do contexto. Resetado a cada novo join bem-sucedido (nova intenção =
  // sempre destravado, mesma linha de base do resto da reconciliação
  // mínima documentada no Plano 07-03).
  const manualMuteRef = useRef(false)

  // Espelha ENSURDECER (botão do rodapé) — ver `setDeafened` no valor do
  // contexto (Plano 07-11). Mesmo padrão/mesma justificativa de
  // `manualMuteRef`, resetado a cada novo join bem-sucedido pela mesma
  // linha de base.
  //
  // Plano 08.5-11: o ref CONTINUA (é lido de dentro de callbacks assíncronos
  // da fila de transições, onde um valor capturado por closure estaria
  // velho), mas agora é espelho do estado `deafened` abaixo. Os dois são
  // escritos juntos, sempre por `setDeafened`.
  const deafenedRef = useRef(false)

  // ENSURDECIDO como ESTADO: o efeito de volume (VOICE-18, mais abaixo)
  // precisa de dependência reativa para reexecutar quando o usuário
  // ensurdece/desensurdece. Um `ref` não reexecuta efeito — foi por isso que
  // o efeito antigo, no `VoiceControlBar`, dependia do `useState` local de
  // lá. Ao centralizar a aplicação aqui, o estado veio junto.
  const [deafened, setDeafenedState] = useState(false)

  // VOICE-18: volume individual por participante, carregado do `localStorage`
  // na primeira renderização do provider (inicializador preguiçoso: a leitura
  // não pode acontecer a cada render).
  const [participantVolumes, setParticipantVolumesState] =
    useState<ParticipantVolumes>(loadParticipantVolumes)

  // Espelho síncrono do mapa acima. Os handlers de menu (Task 3) precisam ler
  // o mapa ATUAL para escrever o próximo, e fazer isso dentro do updater de
  // `setState` significaria gravar no `localStorage` de dentro dele — com o
  // `StrictMode` ligado (main.tsx) o updater roda duas vezes por atualização
  // em desenvolvimento, e efeito colateral ali é justamente o que o React
  // pede para não fazer.
  const participantVolumesRef = useRef<ParticipantVolumes>(participantVolumes)

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
    // Invalida qualquer aplicação de preferências em voo (ver
    // `applyVoicePreferencesAsync`).
    vadGenerationRef.current += 1
    vadMonitorRef.current?.stop()
    vadMonitorRef.current = null
    // Parar o CLONE não para a track publicada: a fonte de captura só
    // encerra quando TODAS as tracks derivadas dela param, e a track do
    // LiveKit continua viva. Mas não parar aqui deixa o microfone aberto
    // para sempre — é o vazamento que ninguém vê e todo mundo sente na
    // bateria (e no ícone de microfone em uso do Windows).
    vadAnalysisTrackRef.current?.stop()
    vadAnalysisTrackRef.current = null
  }

  // Liga o VAD sobre um CLONE da `MediaStreamTrack` do microfone publicado
  // agora (ver `vadAnalysisTrackRef` para o porquê do clone). Retorna
  // `true` só se o monitor ficou de fato de pé.
  //
  // FAIL-OPEN: todo caminho de falha aqui devolve `false` COM erro no
  // console, e quem chama nunca muta o microfone nesse caso — o microfone
  // permanece ABERTO. Um microfone aberto por engano é constrangedor; um
  // microfone mudo por engano é exatamente o bug que este código corrige.
  // Nenhum `return` silencioso.
  function startVadMonitor(prefs: VoicePreferences): boolean {
    const micPublication = room.localParticipant.getTrackPublication(Track.Source.Microphone)
    const publishedTrack = micPublication?.track?.mediaStreamTrack
    if (!publishedTrack) {
      console.error('[voice] VAD: sem track de microfone publicada — microfone permanece ABERTO')
      return false
    }

    let analysisTrack: MediaStreamTrack
    try {
      analysisTrack = publishedTrack.clone()
    } catch (err) {
      console.error(
        '[voice] VAD: falha ao clonar a track de microfone para análise — microfone permanece ABERTO',
        err
      )
      return false
    }

    if (analysisTrack.readyState !== 'live') {
      analysisTrack.stop()
      console.error(
        '[voice] VAD: clone de análise nasceu morto (readyState=%s) — microfone permanece ABERTO',
        analysisTrack.readyState
      )
      return false
    }

    vadAnalysisTrackRef.current = analysisTrack

    try {
      vadMonitorRef.current = createVadMonitor(analysisTrack, {
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
    } catch (err) {
      // Falha no meio do setup: solta o clone que já tinha sido criado
      // antes de sair, senão fica um microfone aberto sem dono.
      analysisTrack.stop()
      vadAnalysisTrackRef.current = null
      vadMonitorRef.current = null
      console.error(
        '[voice] VAD: falha ao criar o monitor de detecção de voz — microfone permanece ABERTO',
        err
      )
      return false
    }

    // Este log é o que torna o checkpoint humano em Windows diagnosticável
    // pelo DevTools sem outra rodada de ida e volta.
    console.info('[voice] VAD ativo sobre clone de análise da track publicada')
    return true
  }

  // Relê a preferência salva e reconfigura o VAD ativo sem reconectar à
  // sala — chamado pelo painel de configurações, pela troca de dispositivo
  // de entrada e internamente ao completar um novo join (abaixo). Não faz
  // nada se não há canal conectado agora.
  //
  // ORDEM OBRIGATÓRIA: obter track → clonar → iniciar monitor → SÓ ENTÃO
  // mutar. Se qualquer passo antes do mute falhar, o microfone permanece
  // aberto e transmitindo, com erro no console. Efeito colateral aceito: no
  // join o microfone fica aberto por alguns milissegundos entre
  // `setMicrophoneEnabled(true)` e o mute do VAD — mesmo comportamento do
  // Discord, e preferível a ficar mudo por falha de setup.
  async function applyVoicePreferencesAsync(): Promise<void> {
    const prefs = loadVoicePreferences()

    // Plano 07-06 (VOICE-11): o processo main só mantém a captura nativa do
    // hook global de teclado ligada enquanto o modo salvo é 'ptt' — nunca
    // captura teclado à toa em modo 'vad' (o padrão). Sincroniza a cada vez
    // que a preferência é (re)aplicada, independente de haver canal
    // conectado agora (ver src/main/voice/ptt.ts).
    //
    // No alvo web isto é no-op documentado (não há captura nativa para ligar);
    // a chamada fica incondicional de propósito — quem sabe o que fazer com
    // ela é a plataforma, não este arquivo.
    pushToTalk.setActive(prefs.mode === 'ptt')

    if (activeChannelRef.current === null) return

    // Solta monitor e clone da configuração anterior (troca de modo, troca
    // de dispositivo, reaplicação de limiar) e reivindica uma geração nova.
    stopVadMonitor()
    const generation = vadGenerationRef.current

    // modo 'ptt': não inicia o VAD — o Plano 07-06 assume o controle da
    // track nesse modo.
    if (prefs.mode !== 'vad') return

    // FAIL-OPEN: não muta o que não está sendo monitorado.
    if (!startVadMonitor(prefs)) return

    // Um `stopVadMonitor()` rodou durante o setup (leave, troca de canal,
    // troca de modo, desmonte) — o monitor que acabamos de criar já foi
    // derrubado por ele; mutar agora seria mutar a sessão de outra pessoa.
    if (vadGenerationRef.current !== generation) return

    try {
      // A track existe mas fica desabilitada — o VAD é quem liga/desliga a
      // partir daqui, nunca o usuário diretamente enquanto este modo
      // estiver ativo.
      await room.localParticipant.setMicrophoneEnabled(false, AUDIO_CAPTURE_OPTIONS)
    } catch (err) {
      console.error('[voice] VAD: falha ao fechar o microfone após iniciar o monitor', err)
    }
  }

  // Fachada síncrona: o painel de configurações, o efeito de PTT e o
  // handler de troca de dispositivo chamam sem `await` — a assinatura
  // `() => void` de `VoiceContextValue` não muda.
  function applyVoicePreferences(): void {
    void applyVoicePreferencesAsync().catch((err) =>
      console.error('[voice] applyVoicePreferences falhou', err)
    )
  }

  // Estável por toda a vida do provider (deps `[]`, lê só uma ref): o
  // medidor de nível do painel de configurações usa isto como dependência
  // de efeito — uma função recriada a cada render faria o efeito derrubar e
  // recriar um `AudioContext` a cada render do provider.
  const getVadAnalysisTrack = useCallback((): MediaStreamTrack | null => {
    return vadAnalysisTrackRef.current
  }, [])

  // SHARE-01/03/04: publica a tela e, SE o usuário quiser E esta máquina
  // conseguir, o áudio do compartilhamento. O `getDisplayMedia` que o SDK
  // dispara por baixo é interceptado pelo handler do processo main
  // (`src/main/screenshare.ts`), que abre o seletor de fontes (Plano 08-04) e
  // concede a escolha do usuário — SÓ VÍDEO, em todos os caminhos.
  //
  // Fase 8.6: o áudio virou um SEGUNDO PASSO, depois do vídeo, e vem de outra
  // captura (WASAPI por processo, no main) publicada como track separada. A
  // ordem é o desenho: o vídeo é o que não pode falhar, e nada do áudio pode
  // derrubá-lo.
  //
  // SHARE-08 (Plano 08-05): a preferência de qualidade é lida AQUI, a cada
  // início — nunca capturada num estado de React no mount. É o que faz a
  // escolha valer para o PRÓXIMO compartilhamento sem tocar no que já está
  // no ar: quem troca o toggle no meio de uma transmissão não tem a imagem
  // derrubada, e quem troca antes de compartilhar tem a escolha respeitada.
  async function startScreenShare(): Promise<void> {
    // Compartilhar exige estar de fato conectado — o botão do rodapé já é
    // desabilitado fora disso, mas a guarda vale para qualquer outra via
    // (atalho, IPC futuro) que chame isto direto.
    if (room.state !== ConnectionState.Connected) {
      console.warn('[screenshare] ignorando início: sala não conectada (%s)', room.state)
      return
    }
    // `systemAudio` NÃO é a palavra final aqui, e é isso que o FIX de
    // 2026-08-25 comprou: no DESKTOP ele é relido depois que o seletor fecha
    // (ver `screenShare.startAudio`), e é essa segunda leitura que manda. O
    // valor passa por aqui só porque o contrato de plataforma o pede — na WEB
    // não há um segundo passo para reler nada, e quem decide sobre o áudio é a
    // pessoa, na caixinha do próprio diálogo do Chrome. Nenhum dos dois alvos
    // ramifica as constraints por ele hoje; os dois dizem por quê, no próprio
    // `captureOptions`.
    const { quality, systemAudio: wantsAudio } = loadScreenSharePreferences()
    const { preset, contentHint } = QUALITY_PRESETS[quality]

    // PASSO 1 — o vídeo. É o que não pode falhar, e é o único `await` desta
    // função que pode abortar tudo.
    try {
      await room.localParticipant.setScreenShareEnabled(
        true,
        screenShare.captureOptions(contentHint, wantsAudio),
        // Terceiro argumento (`publishOptions`), ausente de propósito em
        // 08-02. `screenShareEncoding` é o campo SEPARADO de
        // `videoEncoding` (`08-RESEARCH.md §5`): escrever no segundo não
        // afeta compartilhamento de tela nenhum, e a falha seria silenciosa
        // (publica, só que na qualidade default).
        { screenShareEncoding: preset.encoding }
      )
    } catch (err) {
      // Caminho ESPERADO, não excepcional: o usuário cancela, ou nenhuma
      // tela está disponível (`callback({})` no processo main faz o
      // `getDisplayMedia` rejeitar). Nunca deixar isso subir como rejeição
      // não tratada — `isSharing` continua `false` porque nada foi
      // publicado, e o botão volta sozinho ao estado inicial.
      console.error('[screenshare] falha ao iniciar o compartilhamento de tela', err)
      // `return` e não `finally`: sem vídeo no ar não existe áudio de
      // compartilhamento para iniciar. Iniciar a captura nativa depois de um
      // cancelamento deixaria o WASAPI rodando sem nada para alimentar.
      return
    }

    // PASSO 2 — o áudio. Nada aqui derruba o que já está no ar.
    await screenShare.startAudio(room)
  }

  async function stopScreenShare(): Promise<void> {
    // ANTES de despublicar, e a ordem importa: parar de alimentar a ponte
    // evita chunks chegando a um grafo já fechado, e evita depender do
    // `LocalTrackUnpublished` (que também chama isto, de propósito) para
    // fechar a captura nativa.
    await screenShare.stopAudio()
    try {
      // Sem argumentos de captura: `false` só despublica. O SDK remove as
      // duas tracks (vídeo e áudio do compartilhamento) sozinho — é o que a
      // `source: ScreenShareAudio` da publicação compra.
      await room.localParticipant.setScreenShareEnabled(false)
    } catch (err) {
      console.error('[screenshare] falha ao parar o compartilhamento de tela', err)
    }
  }

  function setManualMute(muted: boolean): void {
    manualMuteRef.current = muted
  }

  // Escreve nos DOIS lugares, sempre: o ref (lido por callbacks assíncronos,
  // onde uma closure sobre o estado estaria velha) e o estado (que faz o
  // efeito de volume reexecutar e o botão do rodapé rerenderizar).
  function setDeafened(next: boolean): void {
    deafenedRef.current = next
    setDeafenedState(next)
  }

  // Grava o mapa inteiro: persiste, atualiza o espelho síncrono e publica o
  // estado. `saveParticipantVolumes` devolve o mapa já sanitizado E PODADO —
  // é esse que vira estado, para que a UI leia exatamente o que ficou
  // guardado (quem voltou ao volume normal some do mapa e passa a valer o
  // padrão, que é o mesmo resultado).
  function commitParticipantVolumes(next: ParticipantVolumes): void {
    const saved = saveParticipantVolumes(next)
    participantVolumesRef.current = saved
    setParticipantVolumesState(saved)
  }

  function setParticipantVolume(identity: string, volume: number): void {
    const current = participantVolumesRef.current
    commitParticipantVolumes({
      ...current,
      [identity]: { volume, silenced: current[identity]?.silenced ?? false }
    })
  }

  function toggleParticipantSilenced(identity: string): void {
    const current = participantVolumesRef.current
    const pref = current[identity]
    commitParticipantVolumes({
      ...current,
      [identity]: {
        volume: pref?.volume ?? DEFAULT_PARTICIPANT_VOLUME,
        silenced: !(pref?.silenced ?? false)
      }
    })
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

  // VOICE-18 (Plano 08.5-11): O ÚNICO LUGAR DO APP QUE ESCREVE VOLUME DE
  // TRACK REMOTA.
  //
  // Antes deste plano, ENSURDECER morava num efeito do `VoiceControlBar` que
  // aplicava `deafened ? 0 : 1` em toda track remota e reaplicava em
  // `TrackSubscribed`. Volume individual e ensurdecimento disputam a MESMA
  // propriedade (`RemoteAudioTrack.setVolume`) — se morassem em efeitos
  // diferentes, o último a rodar venceria, e o sintoma seria "o volume que eu
  // ajustei voltou sozinho ao normal", aparecendo toda vez que alguém
  // entrasse na call ou o deafen fosse alternado, longe da causa. Por isso o
  // efeito de lá foi REMOVIDO e a aplicação foi centralizada aqui, com a
  // precedência decidida por uma função pura e testada
  // (`effectiveVolume`, lib/participant-volumes.ts).
  //
  // Este efeito é IRMÃO do de cima e depende dele: `setVolume` só tem efeito
  // sobre elementos já criados por `attach()`. Os dois convivem de propósito —
  // um cria o elemento, o outro ajusta o volume dele. A ordem também está
  // garantida: o efeito de `attach` é declarado ANTES deste, então o listener
  // dele é registrado antes e roda primeiro no mesmo `TrackSubscribed`. E o de
  // `attach` nunca se reinscreve (deps `[room]`), enquanto este se reinscreve
  // a cada mudança de preferência — o que só o empurra para ainda mais tarde
  // na fila, nunca para antes.
  //
  // `participant.audioTrackPublications` cobre microfone E áudio de sistema do
  // compartilhamento de tela do mesmo participante (SHARE-03), que é o
  // comportamento desejado: silenciar o fulano silencia o fulano inteiro.
  useEffect(() => {
    function applyVolume(participantIdentity: string, track: RemoteTrack): void {
      if (!isAudioTrack(track)) return
      track.setVolume(effectiveVolume(participantVolumes[participantIdentity], deafened))
    }

    // Passada completa: cobre a montagem, toda mudança de preferência e toda
    // alternância de ensurdecer sobre quem JÁ está na call.
    room.remoteParticipants.forEach((participant) => {
      participant.audioTrackPublications.forEach((publication) => {
        if (publication.track) applyVolume(participant.identity, publication.track)
      })
    })

    // Quem entra DEPOIS já entra com o ajuste que eu tinha escolhido para ela
    // — é o mesmo motivo pelo qual o efeito antigo de deafen escutava este
    // evento, agora valendo também para o volume individual.
    function handleTrackSubscribed(
      track: RemoteTrack,
      _publication: RemoteTrackPublication,
      participant: RemoteParticipant
    ): void {
      applyVolume(participant.identity, track)
    }

    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
    return () => {
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed)
    }
  }, [participantVolumes, deafened, room])

  // Fase 8.6: os caminhos de saída em que NINGUÉM CLICOU EM "PARAR".
  //
  // Efeito PRÓPRIO, e não mais uma linha dentro do efeito de ciclo de vida
  // logo abaixo: aquele bloco é o contrato de mídia da Fase 8 e permanece
  // byte-idêntico. Este aqui resolve outro problema — a Armadilha 5 da
  // pesquisa desta fase — e por isso vive sozinho.
  //
  // O que ele cobre, e que `stopScreenShare()` não cobre:
  //
  // | Evento                | Cenário                                          |
  // |-----------------------|--------------------------------------------------|
  // | LocalTrackUnpublished | o Windows revogou a captura; o SDK despublicou    |
  // |                       | sozinho; a tela compartilhada foi desconectada    |
  // | Disconnected          | caí da sala / a rede caiu / saí do canal          |
  // | cleanup do efeito     | o provider desmontou (hot-reload, fechar o app)   |
  //
  // A redundância com `stopScreenShare()` é DELIBERADA, exatamente como na
  // tabela de cinco eventos do bloco abaixo: cada entrada cobre um jeito
  // diferente de a transmissão acabar, e `screenShare.stopAudio()` é
  // idempotente — a segunda chamada é um `return` no primeiro `if`.
  //
  // Sem isto, o modo de falha é o pior possível: a UI diz que parou, e o
  // WASAPI continua capturando o sistema inteiro com o processo main mandando
  // ~100 mensagens/s para um renderer que não escuta mais.
  useEffect(() => {
    function handleLocalTrackUnpublished(publication: LocalTrackPublication): void {
      // Só a track de VÍDEO do compartilhamento dispara o encerramento. A de
      // áudio também gera este evento (o SDK despublica as duas juntas), e
      // reagir a ela seria só reentrância — inofensiva pela idempotência, mas
      // ruído.
      if (publication.source !== Track.Source.ScreenShare) return
      void screenShare.stopAudio()
    }

    function handleDisconnected(): void {
      void screenShare.stopAudio()
    }

    room.on(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished)
    room.on(RoomEvent.Disconnected, handleDisconnected)

    return () => {
      room.off(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished)
      room.off(RoomEvent.Disconnected, handleDisconnected)
      // Desmontagem do provider: nem `Disconnected` nem `LocalTrackUnpublished`
      // são garantidos aqui (o `room.disconnect()` do outro efeito é
      // best-effort e assíncrono), e um AudioContext vazado segura dispositivo
      // e thread de render até o processo morrer.
      void screenShare.stopAudio()
    }
    // Deps só `[room]`: `screenShare.stopAudio` é um MÉTODO DE MÓDULO desde o
    // Plano 10-02 — a mesma referência em todo render, sem nada preso em
    // closure. (Antes era uma função do corpo do componente, redeclarada a
    // cada render; listá-la faria este efeito derrubar e recriar os listeners
    // a cada render, e não listá-la era seguro porque a instância nova e a
    // velha faziam exatamente a mesma coisa.) O estado de "há áudio de
    // compartilhamento no ar" mora no módulo de plataforma, atrás do
    // contrato — este arquivo não sabe mais como esse áudio é produzido nem
    // em qual alvo está rodando.
  }, [room])

  // SHARE-02/SHARE-06 (Plano 08-06): quais telas estão no ar AGORA. Efeito
  // separado do de áudio remoto de propósito — os dois escutam
  // `TrackSubscribed`/`TrackUnsubscribed`, mas resolvem problemas opostos: o
  // de áudio ANEXA o elemento ele mesmo (som não tem UI, o `<audio>` vive num
  // container invisível); este aqui não toca em DOM nenhum, só mantém a
  // lista que a `ConversationArea` renderiza — quem anexa o `<video>` é o
  // componente, porque é ele que sabe onde na tela o vídeo cabe.
  //
  // A track de ÁUDIO do compartilhamento (`Track.Source.ScreenShareAudio`)
  // não passa por aqui e não precisa: `isAudioTrack` a captura no efeito
  // acima e ela toca pelo mesmo caminho do microfone dos outros, sem UI
  // própria — que é o objetivo (SHARE-03: ser ouvida).
  //
  // Cinco eventos, e nenhum deles é redundante — cada um cobre um jeito
  // diferente de o vídeo precisar sumir:
  //
  // | Evento                    | Cenário                                       |
  // |---------------------------|-----------------------------------------------|
  // | TrackUnsubscribed         | apresentador clicou em "parar" (caminho limpo) |
  // | TrackUnpublished          | despublicação sem passar por desinscrição      |
  // | ParticipantDisconnected   | apresentador FECHOU O APP / caiu da rede       |
  // | LocalTrackUnpublished     | fui EU que parei de compartilhar               |
  // | Disconnected              | fui EU que caí/saí do canal                    |
  //
  // Os quatro primeiros são idempotentes entre si (remover um `trackSid` que
  // já saiu é no-op), e essa redundância é deliberada: verificado no bundle
  // instalado do `livekit-client` 2.22 que `RemoteParticipant.unpublishTrack`
  // chama `track.stop()` — que só desabilita a `MediaStreamTrack`, sem
  // desanexar nem remover elemento nenhum do DOM. Ou seja: se o app não tirar
  // o `<video>` da tela por conta própria, ele FICA lá. O frame congelado do
  // HANDOFF não é hipótese, é o comportamento padrão de quem não faz nada.
  useEffect(() => {
    function handleTrackSubscribed(
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant
    ): void {
      if (track.source !== Track.Source.ScreenShare) return
      // Guarda de tipo, não paranoia: `Track.Source.ScreenShare` é só a
      // ORIGEM, e `isVideoTrack` é o que garante ao TypeScript (e a quem
      // chama `attach()` depois) que existe um `<video>` do outro lado.
      if (!isVideoTrack(track)) return

      setScreenShareTracks((prev) =>
        addScreenShareEntry(prev, {
          trackSid: publication.trackSid,
          participantIdentity: participant.identity,
          isLocal: false,
          track
        })
      )
    }

    // Remoção nunca filtra por origem: `removeScreenShareEntryBySid` é no-op
    // para um sid que não está na lista, então despublicação de microfone ou
    // de câmera passa reto sem custo. Uma condição a menos para errar no
    // caminho que precisa ser infalível.
    function handleTrackUnsubscribed(
      _track: RemoteTrack,
      publication: RemoteTrackPublication
    ): void {
      setScreenShareTracks((prev) => removeScreenShareEntryBySid(prev, publication.trackSid))
    }

    function handleTrackUnpublished(publication: RemoteTrackPublication): void {
      setScreenShareTracks((prev) => removeScreenShareEntryBySid(prev, publication.trackSid))
    }

    // O caminho SUJO de SHARE-06, e o motivo de este plano existir: quem
    // compartilhava fechou o app à força, perdeu a rede ou foi derrubado pelo
    // SFU. Não há promessa de evento por track nesse cenário — mas
    // `ParticipantDisconnected` chega, e ele basta para limpar tudo o que era
    // daquela pessoa.
    function handleParticipantDisconnected(participant: RemoteParticipant): void {
      setScreenShareTracks((prev) =>
        removeScreenShareEntriesOfParticipant(prev, participant.identity)
      )
    }

    // A própria tela: `TrackSubscribed` só existe para tracks REMOTAS (o
    // cliente não se inscreve no que ele mesmo publica), então a
    // auto-visualização vem do par local — o mesmo que 08-02/08-05 já usam
    // para `isSharing` e para `voiceStates.sharing`.
    function handleLocalTrackPublished(publication: LocalTrackPublication): void {
      if (publication.source !== Track.Source.ScreenShare) return
      const track = publication.track
      if (!isVideoTrack(track)) return

      setScreenShareTracks((prev) =>
        addScreenShareEntry(prev, {
          trackSid: publication.trackSid,
          participantIdentity: room.localParticipant.identity,
          isLocal: true,
          track
        })
      )
    }

    function handleLocalTrackUnpublished(publication: LocalTrackPublication): void {
      setScreenShareTracks((prev) => removeScreenShareEntryBySid(prev, publication.trackSid))
    }

    // Sair (ou cair) do canal derruba TODA tela em exibição, inclusive a
    // própria. Mesma justificativa do reset de `isSharing` em 08-02: uma
    // queda abrupta não garante evento nenhum por track.
    function handleDisconnected(): void {
      setScreenShareTracks((prev) => clearScreenShareEntries(prev))
    }

    // Higiene de hot-reload/remontagem, espelhando o efeito de áudio acima:
    // cobre tracks de tela que já estavam inscritas antes destes listeners
    // existirem.
    room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        const track = publication.track
        if (!track) return
        handleTrackSubscribed(track, publication, participant)
      })
    })

    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
    room.on(RoomEvent.TrackUnpublished, handleTrackUnpublished)
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
    room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished)
    room.on(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished)
    room.on(RoomEvent.Disconnected, handleDisconnected)

    return () => {
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed)
      room.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
      room.off(RoomEvent.TrackUnpublished, handleTrackUnpublished)
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
      room.off(RoomEvent.LocalTrackPublished, handleLocalTrackPublished)
      room.off(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished)
      room.off(RoomEvent.Disconnected, handleDisconnected)
      setScreenShareTracks((prev) => clearScreenShareEntries(prev))
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

    // SHARE-05 (Plano 08-05): `voiceStates.sharing` no Convex é escrito SÓ
    // daqui — dos dois handlers de track local abaixo, nunca de
    // `startScreenShare`/`stopScreenShare`. A razão é a regra arquitetural
    // da fase: o LiveKit não é fonte da verdade, mas a publicação REAL da
    // track é o único fato observável de "esta pessoa está compartilhando
    // agora". Escrever a partir do clique deixaria `sharing: true` no
    // Convex se `setScreenShareEnabled` falhasse (ou se o usuário
    // cancelasse o seletor), e `sharing` órfão é falha silenciosa: ninguém
    // vê erro, só um indicador que nunca some. Escrever a partir do evento
    // também cobre de graça a despublicação que o próprio SDK dispara
    // sozinho (Windows revogando a captura, tela desconectada).
    //
    // Nunca lança para fora: um erro aqui vira log. O caso conhecido e
    // ESPERADO é a linha de `voiceStates` já não existir (`setSharing`
    // lança nesse caso, ver 08-01) — daí a guarda por `activeChannelRef`
    // abaixo, que cobre a saída deliberada do canal.
    function syncSharingToConvex(sharing: boolean): void {
      // Saindo (ou já fora) do canal: `activeChannelRef` é zerado de forma
      // SÍNCRONA na fila de transições, antes de `leaveVoiceChannel`
      // apagar a linha e de `room.disconnect()` despublicar as tracks. Sem
      // esta guarda, todo `leave` com compartilhamento ativo dispararia um
      // `setSharing(false)` contra uma linha já apagada — erro no console
      // sem defeito real, exatamente o ruído que o plano manda evitar. Não
      // há `sharing` órfão nesse caminho: a linha inteira deixou de
      // existir.
      if (activeChannelRef.current === null) return
      void setSharingMutation({ sharing }).catch((err) => {
        console.error('[screenshare] setSharing(%s) falhou', sharing, err)
      })
    }

    // SHARE-02: `isSharing` segue a publicação REAL da track de tela, não o
    // clique. Só a track de VÍDEO (`Track.Source.ScreenShare`) manda: a de
    // áudio (`ScreenShareAudio`) é publicada/despublicada na mesma operação
    // e usá-la também faria o estado oscilar duas vezes por
    // início/parada — e ela pode legitimamente não existir (usuário sem
    // áudio de sistema disponível) sem que o compartilhamento tenha falhado.
    // O mesmo filtro governa a escrita no Convex: uma linha de
    // `voiceStates` por pessoa, um `sharing` por pessoa, uma track que o
    // define.
    function handleLocalTrackPublished(publication: LocalTrackPublication): void {
      if (publication.source !== Track.Source.ScreenShare) return
      setIsSharing(true)
      syncSharingToConvex(true)
    }

    function handleLocalTrackUnpublished(publication: LocalTrackPublication): void {
      if (publication.source !== Track.Source.ScreenShare) return
      setIsSharing(false)
      syncSharingToConvex(false)
    }

    function handleDisconnected(): void {
      // Sair do canal (ou cair dele) termina qualquer compartilhamento: as
      // tracks morrem com a conexão. Resetado aqui, e não só via
      // `LocalTrackUnpublished`, porque uma queda abrupta não
      // necessariamente emite o evento de despublicação — sem isto o botão
      // ficaria preso em "compartilhando" depois de sair do canal.
      //
      // Deliberadamente SEM `setSharing` no Convex (Plano 08-05): a linha
      // inteira de `voiceStates` já deixou de existir — por
      // `leaveVoiceChannel` quando a saída é nossa, pelo webhook de
      // `participant_left` (07-02) quando o app morreu. Chamar `setSharing`
      // aqui só encontraria linha apagada e lançaria. O caso em que o app
      // morre COM a tela no ar é do webhook `track_unpublished` (08-01),
      // não deste handler.
      setIsSharing(false)

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

    // `switchActiveDevice('audioinput', ...)` (painel de configurações,
    // VOICE-13) substitui a `MediaStreamTrack` publicada por baixo. Sem
    // isto, o clone de análise do VAD continuaria preso ao microfone
    // ANTIGO: o VAD decidiria "está falando" ouvindo um dispositivo que o
    // usuário abandonou, e ainda manteria esse dispositivo aberto
    // (vazamento). Reinstala tudo pelo caminho único de
    // `applyVoicePreferences`, que já respeita o modo salvo.
    function handleActiveDeviceChanged(kind: MediaDeviceKind): void {
      // A guarda por `kind` é obrigatória: trocar a SAÍDA de áudio
      // (`audiooutput`) não pode reiniciar o VAD à toa.
      if (kind !== 'audioinput') return
      if (activeChannelRef.current === null) return
      applyVoicePreferences()
    }

    room.on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged)
    room.on(RoomEvent.Disconnected, handleDisconnected)
    room.on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakersChanged)
    room.on(RoomEvent.ConnectionQualityChanged, handleConnectionQualityChanged)
    room.on(RoomEvent.ActiveDeviceChanged, handleActiveDeviceChanged)
    room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished)
    room.on(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished)

    return () => {
      room.off(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged)
      room.off(RoomEvent.Disconnected, handleDisconnected)
      room.off(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakersChanged)
      room.off(RoomEvent.ConnectionQualityChanged, handleConnectionQualityChanged)
      room.off(RoomEvent.ActiveDeviceChanged, handleActiveDeviceChanged)
      room.off(RoomEvent.LocalTrackPublished, handleLocalTrackPublished)
      room.off(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished)
      // Higiene de hot-reload/fechamento do app — best-effort, não é o
      // mecanismo principal de saída (isso é o webhook do Plano 07-02).
      clearSpeakingAndQuality()
      stopVadMonitor()
      void room.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Plano 07-06 (VOICE-11): push-to-talk real. No DESKTOP, via hook global de
  // teclado no processo main — `globalShortcut` do Electron não separa
  // keydown/keyup, então não dá pra fazer "segurar para falar" com ele. No
  // alvo WEB (Plano 10-02), via `keydown`/`keyup` na própria janela, que só
  // funciona com o app em foco. Quem escolhe é o alias `@platform`; os dois
  // handlers abaixo são idênticos nos dois alvos e não sabem qual está
  // rodando.
  // Registrado uma única vez, no mount do provider — não depende de estar
  // conectado, já que o usuário pode segurar a tecla antes mesmo de entrar
  // num canal; nesses dois handlers, `activeChannelRef.current === null`
  // faz o early-return e nada acontece.
  useEffect(() => {
    // Sincroniza o processo main com o modo salvo agora, no boot do
    // provider — reaproveita `applyVoicePreferences` (que já notifica o
    // main e, se houver canal conectado, também religa o VAD/PTT sobre a
    // track publicada) em vez de duplicar essa lógica aqui.
    applyVoicePreferences()

    const offPtt = pushToTalk.subscribe({
      onDown: () => {
        if (activeChannelRef.current === null) return
        if (loadVoicePreferences().mode !== 'ptt') return
        // Mute manual sempre vence — mesma regra do VAD (ver
        // `startVadMonitor` acima): segurar a tecla de PTT nunca reabre o
        // microfone se o usuário mutou pelo botão do rodapé.
        if (manualMuteRef.current) return
        void room.localParticipant.setMicrophoneEnabled(true, AUDIO_CAPTURE_OPTIONS)
      },
      onUp: () => {
        if (activeChannelRef.current === null) return
        if (loadVoicePreferences().mode !== 'ptt') return
        // Desligar é sempre permitido, mesmo com mute manual ativo — harmless,
        // a track já estaria desabilitada.
        void room.localParticipant.setMicrophoneEnabled(false, AUDIO_CAPTURE_OPTIONS)
      }
    })

    return () => {
      offPtt()
      // Nunca deixar a captura nativa do teclado ligada além da vida deste
      // provider (hot-reload/remontagem inclusos) — o mount seguinte
      // ressincroniza via `applyVoicePreferences()` acima.
      pushToTalk.setActive(false)
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

          // Plano 07-11 (correção de defeito relatado após teste em
          // Windows: "quando eu saio da call, nenhum som toca"). Disparado
          // AQUI — no ponto exato da transição de saída, antes de a
          // conexão cair (`leaveVoiceChannelMutation`/`room.disconnect()`
          // abaixo ainda nem rodaram) — porque este é o único lugar onde a
          // saída própria é uma AÇÃO capturada, não um dado observado
          // depois. `useVoiceJoinLeaveSounds` (voice-sounds.ts) nunca
          // alcança este caso pelo diff de `voiceParticipantsByChannel`: a
          // query dessa hook vira `'skip'` no mesmo tick em que
          // `joinedVoiceChannelId` fica `null`, então nunca existe um
          // snapshot seguinte mostrando a lista sem o próprio usuário para
          // comparar. Roda tanto para uma saída de verdade (`target ===
          // null`) quanto para uma troca direta de canal (`target !==
          // null`, join ao novo canal roda logo abaixo) — nos dois casos a
          // sessão anterior de fato terminou. Sem janela de graça de
          // reconexão (essa janela só faz sentido para a saída de OUTROS,
          // que É um dado observado por webhook e pode ser flutuação de
          // rede — aqui é o próprio usuário agindo, imediato).
          const prefsAtLeave = loadVoicePreferences()
          if (prefsAtLeave.soundsEnabled && !deafenedRef.current) {
            playSelfLeaveTone()
          }

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
            // Plano 08.5-11: `setDeafened` (não `deafenedRef.current = false`
            // direto) porque agora existe ESTADO junto do ref, e o
            // `VoiceControlBar` renderiza o botão a partir dele. Antes deste
            // plano os dois divergiam neste exato ponto: o ref só zerava aqui
            // (join bem-sucedido), enquanto a cópia local do rodapé zerava na
            // troca de INTENÇÃO — ou seja, um join que falhava deixava o botão
            // dizendo "não ensurdecido" com o ref dizendo o contrário.
            setDeafened(false)
            // Aplica a preferência de transmissão salva (VAD por padrão) à
            // track recém-publicada. Em modo VAD, a track existe mas
            // começa desabilitada — o VAD é quem liga/desliga a partir
            // daqui (07-05-PLAN.md Task 2). Com `await`: o join só termina
            // com o estado de transmissão de fato aplicado, então um leave
            // imediatamente depois não corre contra um setup pela metade.
            await applyVoicePreferencesAsync()
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
    setManualMute,
    setDeafened,
    deafened,
    participantVolumes,
    setParticipantVolume,
    toggleParticipantSilenced,
    isSharing,
    screenShareTracks,
    startScreenShare,
    stopScreenShare,
    getVadAnalysisTrack
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
