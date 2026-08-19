// Testador de microfone (Plano 07-09, VOICE-21/VOICE-22): módulo puro (sem React,
// independente de componente) com as duas etapas do teste — medidor de nível local
// (sem entrar em canal nenhum) e ida-e-volta real pelo servidor LiveKit (duas
// conexões simultâneas numa sala efêmera dedicada, nunca um canal real).
//
// A gravação/reprodução local que existia aqui foi removida (Plano 07-09, cleanup
// pós-verificação): o teste de ida-e-volta pelo servidor cobre tudo que ela provava
// e mais — token, SFU, codec e o caminho de rede real. O medidor de nível continua
// porque é o que torna o slider de sensibilidade do VAD usável (ver o ruído da sala
// cair abaixo da marca e a própria voz cruzá-la) e porque funciona sem rede nenhuma,
// então ainda diz se o microfone está captando quando o servidor está inalcançável.
//
// O medidor de nível REAPROVEITA `createVadMonitor` de `lib/vad.ts` (mesma leitura de
// `AnalyserNode` que `VoiceSettingsPopover` já usa) em vez de duplicar a leitura de
// RMS — só configurado com um limiar inatingível (nunca dispara `onSpeakingChange`,
// só lê `onLevel` a cada frame).

import { Room, RoomEvent, isAudioTrack, type RemoteTrack } from 'livekit-client'

import { createVadMonitor, type VadMonitor } from './vad'

// Mesma constante de `voice-context.tsx` (VOICE-16): cancelamento de eco, supressão
// de ruído e ganho automático nunca vêm ligados por padrão — sempre explícitos em
// todo call-site que abre o microfone, incluindo este.
const AUDIO_CAPTURE_OPTIONS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
}

// --- Medidor de nível local (Task 1) ---

export type MicCapture = {
  stream: MediaStream
  track: MediaStreamTrack
  /** Encerra a captura — para a track de verdade, não só solta a referência. Chamar
   * ao fechar o painel é obrigatório: microfone que continua aberto depois de fechar
   * a tela é o tipo de vazamento que ninguém percebe e todo mundo sente na bateria. */
  stop: () => void
}

/** Abre o microfone selecionado (ou o default do sistema, se `deviceId` for
 * `undefined`) fora de qualquer `Room` do LiveKit — é o que permite medir nível sem
 * entrar em canal nenhum (VOICE-21). */
export async function openMicCapture(deviceId?: string): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId
      ? { deviceId: { exact: deviceId }, ...AUDIO_CAPTURE_OPTIONS }
      : AUDIO_CAPTURE_OPTIONS
  })

  const track = stream.getAudioTracks()[0]
  if (!track) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('Nenhuma track de áudio no stream capturado')
  }

  return {
    stream,
    track,
    stop(): void {
      stream.getTracks().forEach((t) => t.stop())
    }
  }
}

/** Medidor de nível ao vivo sobre a MESMA leitura de `AnalyserNode` de `lib/vad.ts` —
 * threshold acima de qualquer nível RMS real (0-1), nunca cruza, só existe para ler
 * `onLevel` a cada frame. Devolve o mesmo `VadMonitor` de `vad.ts`; `stop()` fecha o
 * `AudioContext` sem vazar. */
export function startLevelMeter(
  track: MediaStreamTrack,
  onLevel: (level: number) => void
): VadMonitor {
  return createVadMonitor(track, { threshold: 2, onSpeakingChange: () => {}, onLevel })
}

// --- Ida e volta pelo servidor (Task 2) ---

/**
 * Tipo de candidato ICE selecionado para a conexão de mídia — o mesmo dado que provou
 * o INFRA-02 na Fase 1. `relay` significa que o tráfego passou pelo TURN da VPS;
 * `host`/`srflx`/`prflx` significam alguma forma de conexão mais direta.
 * `desconhecido` cobre navegadores/versões onde `getStats()` não expõe os relatórios
 * esperados — nunca lançamos por causa disso, só relatamos que não foi possível
 * determinar.
 */
export type IceCandidateType = 'relay' | 'srflx' | 'prflx' | 'host' | 'desconhecido'

export type LoopbackTestTokens = {
  url: string
  publisherToken: string
  subscriberToken: string
}

export type RunLoopbackTestOptions = LoopbackTestTokens & {
  /** Dispositivo de entrada a publicar — mesmo padrão de `deviceId` do resto do
   * módulo; `undefined` usa o default do sistema. */
  inputDeviceId?: string
  /** Chamado assim que a track remota foi assinada e anexada (já tocando de
   * verdade) — sinal para a UI dizer "fale agora, você deve se ouvir". */
  onPlaybackReady?: () => void
}

export type LoopbackTestHandle = {
  icePath: IceCandidateType
  /** Encerra AS DUAS conexões e solta o microfone publicado. Idempotente — chamar
   * mais de uma vez (ex.: usuário fecha o painel logo depois de o teste terminar
   * sozinho) não lança. */
  stop: () => Promise<void>
}

type LocalCandidateStats = RTCStats & { candidateType?: RTCIceCandidateType }
type SelectedCandidatePairStats = RTCIceCandidatePairStats & { selected?: boolean }

/**
 * Lê, via `getStats()` bruto do `RTCPeerConnection` publisher, o `candidateType` do
 * candidato LOCAL do par selecionado para a conexão de mídia. `room.engine` é um
 * campo interno do `livekit-client` (documentado como `@internal` no próprio SDK,
 * sem API pública equivalente para "qual caminho ICE foi selecionado") — acesso
 * best-effort, envolto em try/catch, nunca deve derrubar o teste se a forma mudar
 * numa versão futura do SDK.
 */
async function readSelectedIceCandidateType(room: Room): Promise<IceCandidateType> {
  try {
    const transport = room.engine.pcManager?.publisher
    if (!transport) return 'desconhecido'
    const stats = await transport.getStats()

    let selectedPairId: string | undefined
    const pairs = new Map<string, SelectedCandidatePairStats>()
    const localCandidates = new Map<string, LocalCandidateStats>()

    stats.forEach((report) => {
      if (report.type === 'transport') {
        const transportReport = report as RTCTransportStats
        if (transportReport.selectedCandidatePairId) {
          selectedPairId = transportReport.selectedCandidatePairId
        }
      } else if (report.type === 'candidate-pair') {
        const pairReport = report as SelectedCandidatePairStats
        pairs.set(pairReport.id, pairReport)
        if (!selectedPairId && pairReport.selected) selectedPairId = pairReport.id
      } else if (report.type === 'local-candidate') {
        localCandidates.set(report.id, report as LocalCandidateStats)
      }
    })

    if (!selectedPairId) return 'desconhecido'
    const pair = pairs.get(selectedPairId)
    const local = pair ? localCandidates.get(pair.localCandidateId) : undefined
    return local?.candidateType ?? 'desconhecido'
  } catch (err) {
    console.error('[mic-test] falha ao ler o tipo de candidato ICE selecionado', err)
    return 'desconhecido'
  }
}

/**
 * Abre DUAS conexões reais com o LiveKit na sala efêmera assinada pelo backend
 * (`api.voiceToken.mintMicTestTokens` — nunca `joinVoiceChannel`: aquela action
 * sempre assina `identity: userId`, e duas conexões simultâneas com o MESMO identity
 * no MESMO room fariam o LiveKit derrubar a mais antiga assim que a segunda
 * entrasse). Uma Room publica o microfone, a outra assina e REPRODUZ via
 * `track.attach()` — mesmo padrão de `voice-context.tsx` (Plano 07-05): sem
 * `attach()`, `RemoteAudioTrack` nunca produz um elemento tocando de verdade.
 *
 * Se qualquer etapa falhar, as duas conexões são encerradas antes de propagar o
 * erro — nunca deixa uma `Room` pendurada.
 */
export async function runServerLoopbackTest(
  opts: RunLoopbackTestOptions
): Promise<LoopbackTestHandle> {
  const publisherRoom = new Room()
  const subscriberRoom = new Room()
  let audioElements: HTMLMediaElement[] = []
  let torndown = false

  async function teardown(): Promise<void> {
    if (torndown) return
    torndown = true
    audioElements.forEach((el) => el.remove())
    audioElements = []
    await Promise.allSettled([publisherRoom.disconnect(), subscriberRoom.disconnect()])
  }

  try {
    await Promise.all([
      publisherRoom.connect(opts.url, opts.publisherToken),
      subscriberRoom.connect(opts.url, opts.subscriberToken)
    ])

    // VOICE-16: as três opções sempre explícitas, também neste call-site.
    await publisherRoom.localParticipant.setMicrophoneEnabled(true, {
      ...AUDIO_CAPTURE_OPTIONS,
      ...(opts.inputDeviceId ? { deviceId: opts.inputDeviceId } : {})
    })

    await new Promise<void>((resolve) => {
      let settled = false
      function finish(): void {
        if (settled) return
        settled = true
        resolve()
      }
      function handleSubscribed(track: RemoteTrack): void {
        if (!isAudioTrack(track)) return
        const element = track.attach()
        element.style.display = 'none'
        document.body.appendChild(element)
        audioElements.push(element)
        opts.onPlaybackReady?.()
        finish()
      }
      subscriberRoom.on(RoomEvent.TrackSubscribed, handleSubscribed)
      // Segurança: se a track assinada não chegar (rede muito lenta, publish
      // falhou em silêncio), segue em frente em vez de travar o teste para sempre
      // — o chamador ainda recebe `icePath` e pode reportar "sem áudio".
      setTimeout(finish, 8000)
    })

    const icePath = await readSelectedIceCandidateType(publisherRoom)

    return { icePath, stop: teardown }
  } catch (err) {
    await teardown()
    throw err
  }
}
