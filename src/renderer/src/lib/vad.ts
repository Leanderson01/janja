// Motor de detecção de voz (Plano 07-05): puro Web Audio API, independente
// de React, sem dependência do `livekit-client` — recebe um `MediaStreamTrack`
// cru (a track de captura local, a mesma que o SDK publica) e decide quando
// há fala. `VoiceProvider` é quem decide o que fazer com `onSpeakingChange`
// (ligar/desligar o microfone publicado); este módulo não conhece LiveKit.
//
// Três peças, de propósito separadas:
//
//   1. `createVadDecision` — a DECISÃO, pura (sem Web Audio): recebe
//      `(nívelDb, agoraMs)` bloco a bloco e diz se está falando. Testada no
//      ambiente padrão (`vad-decision.test.ts`).
//   2. `keepAudioContextRunning` — mantém o AudioContext andando (bugs reais
//      anteriores; não mexer sem ler o bloco de comentário dele).
//   3. `createVadMonitor` — a MEDIÇÃO: um AudioWorklet (`vad-level-processor.js`)
//      mede blocos de ~10 ms na thread de áudio e alimenta a decisão. Se o
//      worklet não carregar, cai para `AnalyserNode` + `setInterval`.
//
// Rodada de correção (nov/2026, teste real do Leo no Windows: "preciso falar
// mais alto pra pegar" e "corta minha voz"; ele zerou o limiar). As causas
// estavam aqui: limiar em RMS LINEAR com padrão 0,15 (≈ −16,5 dBFS, voz alta —
// fala normal com AGC fica em −35…−20 dBFS), laço preso ao rAF (congela com a
// janela oculta), abrir e fechar no mesmo limiar e soltura de 300 ms. Agora:
// dBFS, worklet, histerese de 6 dB, soltura de 600 ms e limiar automático.

// `&no-inline`, e não só `?url`: o alvo WEB não tem `assetsInlineLimit: 0` (só o
// Electron tem), e um worklet pequeno viraria `data:` no build — que a CSP
// `script-src 'self'` bloqueia, e o VAD cairia sempre no fallback sem ninguém
// ver. Guardado por `scripts/verify-web-bundle.mjs` (afirmação 5).
import levelProcessorUrl from './vad-level-processor.js?url&no-inline'

// --------------------------------------------------------------------------
// A decisão (pura)
// --------------------------------------------------------------------------

/** Piso da escala: silêncio digital. É também o mínimo do slider. */
export const VAD_SILENCE_DB = -100
/** Topo da escala (0 dBFS, amplitude cheia). É também o máximo do slider. */
export const VAD_MAX_DB = 0
/** Limiar manual usado quando o valor recebido não é número. */
const FALLBACK_THRESHOLD_DB = -50

/** Fecha depois de tanto tempo CONTÍNUO abaixo do limiar de fechamento. */
export const VAD_RELEASE_MS = 600
/** Aberto, só conta como "abaixo" quando cai abaixo de `limiar − 6 dB`. */
export const VAD_HYSTERESIS_DB = 6

/** Automático: limiar de abertura = piso de ruído + 14 dB... */
export const VAD_AUTO_MARGIN_DB = 14
/** ...preso entre −65 dB (sala silenciosa, supressão de ruído ligada)... */
export const VAD_AUTO_MIN_THRESHOLD_DB = -65
/** ...e −30 dB (sala barulhenta: acima disso, fala normal não abriria). */
export const VAD_AUTO_MAX_THRESHOLD_DB = -30
/** Piso inicial: limiar inicial de −46 dB, para não nascer mudo nem surdo. */
export const VAD_AUTO_INITIAL_FLOOR_DB = -60
/** Quanto o piso pode SUBIR por segundo. Descer é instantâneo. */
export const VAD_NOISE_FLOOR_RISE_DB_PER_S = 1
/**
 * Maior intervalo entre blocos que conta como "tempo para o piso subir".
 * Um buraco maior (contexto suspenso, timer do fallback espaçado em segundo
 * plano) não pode virar um salto do piso de dezenas de dB de uma vez.
 */
const MAX_FLOOR_STEP_MS = 1000

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function sanitizeThresholdDb(value: number): number {
  return Number.isNaN(value) ? FALLBACK_THRESHOLD_DB : clamp(value, VAD_SILENCE_DB, VAD_MAX_DB)
}

/** RMS linear (0–1) → dBFS, preso em −100…0. Zero, negativo e NaN viram −100. */
export function rmsToDb(rms: number): number {
  if (!(rms > 0)) return VAD_SILENCE_DB
  return clamp(20 * Math.log10(rms), VAD_SILENCE_DB, VAD_MAX_DB)
}

export type VadDecisionOptions = {
  /** "Determinar automaticamente a sensibilidade de entrada" (Discord). */
  autoSensitivity: boolean
  /** Limiar manual de abertura em dBFS (−100…0). Só vale com o automático desligado. */
  thresholdDb: number
}

export type VadDecision = {
  /** Um bloco medido. Devolve se está falando DEPOIS deste bloco. */
  push: (levelDb: number, nowMs: number) => boolean
  readonly speaking: boolean
  /** Limiar de ABERTURA em vigor — no automático, o calculado. */
  readonly thresholdDb: number
  /** Estimativa atual do ruído de fundo (dBFS). */
  readonly noiseFloorDb: number
  setThresholdDb: (thresholdDb: number) => void
  setAutoSensitivity: (on: boolean) => void
}

/**
 * A decisão de "está falando", sem Web Audio. Regras:
 *
 * - **Ataque imediato**: fechado, abre no PRIMEIRO bloco >= limiar de abertura.
 * - **Histerese**: aberto, só conta como abaixo quando o nível cai abaixo de
 *   `limiar − 6 dB` — fim de palavra e consoante fraca não contam como pausa.
 * - **Soltura**: fecha depois de 600 ms CONTÍNUOS abaixo do limiar de
 *   fechamento; qualquer bloco acima dele zera a contagem.
 * - **Automático**: limiar = piso de ruído + 14 dB, preso em −65…−30 dB.
 *
 * O piso de ruído é um mínimo com subida lenta: cai NA HORA para um nível
 * menor e sobe no máximo 1 dB/s enquanto o nível está acima dele. Dois
 * ajustes sobre a ideia original, cada um com teste em `vad-decision.test.ts`:
 *
 * - Ele sobe também com o microfone ABERTO. Se só subisse fechado, um ruído
 *   que aparece de repente acima do limiar (ar-condicionado ligando) abriria
 *   o microfone e o deixaria aberto PARA SEMPRE — o piso congelado nunca o
 *   alcançaria. A própria voz não "prende" o piso: fala real tem quedas, e a
 *   primeira pausa o devolve ao ruído de fundo na hora (e 1 dB/s é lento
 *   demais para alcançar a voz durante uma frase).
 * - Silêncio DIGITAL (−100, os zeros do início de uma captura) não mexe no
 *   piso. Senão o piso despencava para −100, o limiar ia a −65 e o ruído real
 *   da sala abria o microfone por meio minuto, até o piso subir de volta.
 *
 * O piso é estimado também no modo manual: ligar o automático já chega
 * calibrado.
 */
export function createVadDecision(options: VadDecisionOptions): VadDecision {
  let autoSensitivity = options.autoSensitivity
  let manualThresholdDb = sanitizeThresholdDb(options.thresholdDb)
  let noiseFloorDb = VAD_AUTO_INITIAL_FLOOR_DB
  let speaking = false
  /** Desde quando (ms) o nível está abaixo do limiar de fechamento; `null` fora disso. */
  let belowSinceMs: number | null = null
  let lastNowMs: number | null = null

  function openThresholdDb(): number {
    if (!autoSensitivity) return manualThresholdDb
    return clamp(
      noiseFloorDb + VAD_AUTO_MARGIN_DB,
      VAD_AUTO_MIN_THRESHOLD_DB,
      VAD_AUTO_MAX_THRESHOLD_DB
    )
  }

  function trackNoiseFloor(levelDb: number, elapsedMs: number): void {
    if (levelDb <= VAD_SILENCE_DB) return
    if (levelDb < noiseFloorDb) {
      noiseFloorDb = levelDb
      return
    }
    const rise = (VAD_NOISE_FLOOR_RISE_DB_PER_S * elapsedMs) / 1000
    noiseFloorDb = Math.min(levelDb, noiseFloorDb + rise)
  }

  return {
    push(levelDb: number, nowMs: number): boolean {
      // NaN conta como silêncio; −Infinity e qualquer coisa fora da escala
      // são presos nela. Nada aqui pode lançar: isto roda 100x por segundo.
      const level = Number.isNaN(levelDb)
        ? VAD_SILENCE_DB
        : clamp(levelDb, VAD_SILENCE_DB, VAD_MAX_DB)
      const now = Number.isFinite(nowMs) ? nowMs : lastNowMs
      const elapsedMs =
        now !== null && lastNowMs !== null ? clamp(now - lastNowMs, 0, MAX_FLOOR_STEP_MS) : 0
      if (now !== null) lastNowMs = now

      trackNoiseFloor(level, elapsedMs)
      const openDb = openThresholdDb()

      if (!speaking) {
        if (level >= openDb) {
          speaking = true
          belowSinceMs = null
        }
        return speaking
      }

      if (level >= openDb - VAD_HYSTERESIS_DB) {
        belowSinceMs = null
        return true
      }

      // Sem relógio nenhum ainda não há como medir a soltura: fica aberto.
      if (now === null) return true
      if (belowSinceMs === null) belowSinceMs = now
      if (now - belowSinceMs >= VAD_RELEASE_MS) {
        speaking = false
        belowSinceMs = null
      }
      return speaking
    },
    get speaking(): boolean {
      return speaking
    },
    get thresholdDb(): number {
      return openThresholdDb()
    },
    get noiseFloorDb(): number {
      return noiseFloorDb
    },
    setThresholdDb(thresholdDb: number): void {
      manualThresholdDb = sanitizeThresholdDb(thresholdDb)
    },
    setAutoSensitivity(on: boolean): void {
      autoSensitivity = on
    }
  }
}

// --------------------------------------------------------------------------
// O monitor (medição)
// --------------------------------------------------------------------------

/** O que o medidor da tela recebe, ~30x por segundo. */
export type VadLevelReading = {
  /** PICO de nível (dBFS, −100…0) desde a leitura anterior. */
  levelDb: number
  /** Limiar de abertura em vigor — no automático, o calculado. */
  thresholdDb: number
  speaking: boolean
}

export type VadMonitorOptions = {
  /** "Determinar automaticamente a sensibilidade de entrada" (padrão ligado). */
  autoSensitivity: boolean
  /** Limiar manual de abertura em dBFS (−100…0). */
  thresholdDb: number
  onSpeakingChange: (speaking: boolean) => void
  /**
   * Medidor ao vivo da tela de configurações e do teste de microfone. Chamado
   * no máximo ~30x/s com o PICO do intervalo — o medidor cruzar a marca do
   * limiar é exatamente o que abre o microfone.
   */
  onLevel?: (reading: VadLevelReading) => void
  /** Nome no log de diagnóstico: 'VAD' (padrão) ou 'medidor' nos painéis. */
  label?: string
}

export type VadMonitor = {
  stop: () => void
  /** Limiar manual em dBFS (−100…0), aplicado ao vivo. */
  setThreshold: (thresholdDb: number) => void
  setAutoSensitivity: (on: boolean) => void
}

/**
 * O nome com que o worklet se registra. Exportado para que `new
 * AudioWorkletNode(...)` e `registerProcessor(...)` não divirjam — uma
 * divergência lança só em runtime. `vad.test.ts` compara este valor com o
 * texto do arquivo do worklet.
 */
export const VAD_LEVEL_PROCESSOR_NAME = 'vad-level-meter'

/** Fallback: intervalo entre leituras do `AnalyserNode`. */
const FALLBACK_INTERVAL_MS = 20
/** Fallback: janela de ~10,7 ms a 48 kHz (era 2048, ~43 ms). */
const FALLBACK_FFT_SIZE = 512
/** O medidor da tela não precisa de 100 renders por segundo. */
const LEVEL_REPORT_INTERVAL_MS = 33
/** Vigia do worklet: de quanto em quanto tempo conferir se chegou bloco. */
const WORKLET_WATCHDOG_INTERVAL_MS = 1000
/** Quantas conferências seguidas, com o contexto RODANDO, sem bloco nenhum. */
const WORKLET_WATCHDOG_STRIKES = 2

// --------------------------------------------------------------------------
// Manter o AudioContext ANDANDO — a diferença entre um VAD e um enfeite
// --------------------------------------------------------------------------
//
// Um `AudioContext` só avança o tempo enquanto está `running`. Suspenso, ele
// não roda o grafo: o `AnalyserNode` devolve o mesmo buffer de zeros para
// sempre, o RMS fica em 0, o limiar nunca é cruzado, `onSpeakingChange(true)`
// nunca dispara e o microfone NUNCA abre. Sem exceção, sem rejeição de
// promise, sem nada na tela — o modo de falha mais caro que existe.
//
// E ele nasce suspenso por design. A spec do Web Audio:
//
//   "An AudioContext is said to be allowed to start if the user agent allows
//    the context state to transition from 'suspended' to 'running'. A user
//    agent may disallow this initial transition, and to allow it only when
//    the AudioContext's relevant global object has sticky activation."
//   — https://webaudio.github.io/web-audio-api/#allowed-to-start
//
// E o Chrome, explicitamente:
//
//   "If an AudioContext is created before the document receives a user
//    gesture, it will be created in the 'suspended' state, and you will need
//    to call resume() after the user gesture."
//   — https://developer.chrome.com/blog/autoplay#web_audio
//
// No alvo desktop o Electron afrouxa isso (`webPreferences.autoplayPolicy`
// tem default `no-user-gesture-required`), mas o alvo web (`npm run dev:web`)
// roda sob a política real do Chromium, onde a regra acima vale integralmente.
// Este módulo não pode depender de qual alvo o carregou.
//
// Três detalhes que separam "chamei resume()" de "funciona":
//
// 1. `!== 'running'`, NUNCA `=== 'suspended'`. Existe um quarto estado,
//    `interrupted`: outro app tomou o hardware de áudio, ou o laptop fechou
//    (https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state).
//    Ele congela o grafo igualzinho e passa batido por um teste de igualdade
//    com 'suspended'. O `livekit-client` que este app já usa checa
//    `context.state !== 'running'` exatamente por isso (`RemoteAudioTrack`).
//
// 2. Suspensão POSTERIOR conta. O contexto pode estar `running` no
//    nascimento e ser suspenso depois — SO dormindo, hardware tomado. Por
//    isso ouvimos `statechange` pela vida inteira do monitor, e não só uma
//    vez no construtor.
//
// 3. Quando não há gesto nenhum, `resume()` legitimamente não resolve nada:
//    a política de autoplay simplesmente recusa. Aí a única saída é rearmar
//    no PRÓXIMO gesto do usuário — o mesmo padrão que o `livekit-client` usa
//    em `getNewAudioContext()`, que registra um listener de `click` no
//    `document.body` para tentar de novo. Sem esse rearme, "funciona" vira
//    sorte: depende de o usuário ter clicado em algo antes de entrar no
//    canal. Foi exatamente o ritual observado em uso real — abrir o teste de
//    microfone (um clique) e só então o canal de voz passar a funcionar.
//
// Precedente no próprio repo: `screenshare-audio-bridge.ts` levou a MESMA
// classe de defeito no Plano 08.5-03 (contexto suspenso => `process()` nunca
// chamado => track publicada transmitindo silêncio eterno, sem erro).

/**
 * Estados em que o relógio do contexto NÃO avança. `closed` fica de fora de
 * propósito: dali não se volta, `resume()` só rejeitaria.
 */
function isStalled(state: AudioContextState): boolean {
  return state !== 'running' && state !== 'closed'
}

/**
 * Tempo até desistir de esperar `resume()` e emitir o diagnóstico assim mesmo.
 * `resume()` pode ficar pendente para sempre quando a política de autoplay
 * recusa — o `livekit-client` contorna com `Promise.race([resume(), sleep(200)])`.
 * Aqui ninguém espera por ele (nada é `await`ado), então o timer serve só para
 * garantir que o log de falha saia.
 */
const RESUME_VERDICT_MS = 500

/** Gestos que devolvem "sticky activation" à página; capture=true para ver o
 * evento mesmo que algum handler chame `stopPropagation()`. */
const GESTURE_EVENTS = ['pointerdown', 'mousedown', 'keydown', 'touchend'] as const

/**
 * Mantém `audioContext` em `running` pela vida do monitor: tenta agora, ouve
 * `statechange` para suspensões posteriores e rearma no próximo gesto do
 * usuário quando a política de autoplay recusa. Devolve o descarte, que
 * `stop()` é obrigado a chamar — senão sobra listener no `document`.
 */
export function keepAudioContextRunning(audioContext: AudioContext): () => void {
  let disposed = false
  let gestureArmed = false

  const doc: Document | undefined = typeof document === 'undefined' ? undefined : document

  function onGesture(): void {
    disarmGesture()
    attemptResume('gesto do usuário')
  }

  function armGesture(): void {
    if (disposed || gestureArmed || !doc) return
    gestureArmed = true
    GESTURE_EVENTS.forEach((event) => doc.addEventListener(event, onGesture, true))
    console.warn(
      '[voice] VAD: aguardando um gesto do usuário (clique/tecla) para retomar o AudioContext — ' +
        'até lá a detecção de voz NÃO abre o microfone'
    )
  }

  function disarmGesture(): void {
    if (!gestureArmed || !doc) return
    gestureArmed = false
    GESTURE_EVENTS.forEach((event) => doc.removeEventListener(event, onGesture, true))
  }

  function attemptResume(motivo: string): void {
    if (disposed || !isStalled(audioContext.state)) return

    console.warn(
      '[voice] VAD: AudioContext em estado "%s" (%s) — o AnalyserNode está congelado e o ' +
        'microfone nunca abriria; chamando resume()',
      audioContext.state,
      motivo
    )

    let settled = false
    function verdict(err?: unknown): void {
      if (settled || disposed) return
      settled = true
      if (!isStalled(audioContext.state)) {
        console.info(
          '[voice] VAD: AudioContext retomado (state=%s) — detecção de voz operante',
          audioContext.state
        )
        return
      }
      console.error(
        '[voice] VAD: AudioContext NÃO retomou (state=%s) — a detecção de voz está INOPERANTE ' +
          'e o microfone não vai abrir sozinho',
        audioContext.state,
        err ?? ''
      )
      armGesture()
    }

    try {
      void Promise.resolve(audioContext.resume()).then(
        () => verdict(),
        (err: unknown) => verdict(err)
      )
    } catch (err) {
      // `resume()` síncrono que lança (contexto fechado por baixo, duplo de
      // teste hostil) não pode derrubar a criação do monitor.
      verdict(err)
      return
    }

    setTimeout(
      () => verdict(new Error(`resume() não assentou em ${RESUME_VERDICT_MS}ms`)),
      RESUME_VERDICT_MS
    )
  }

  function onStateChange(): void {
    if (disposed) return
    if (audioContext.state === 'closed') {
      dispose()
      return
    }
    if (isStalled(audioContext.state)) attemptResume('suspenso depois de criado')
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    disarmGesture()
    audioContext.removeEventListener?.('statechange', onStateChange)
  }

  audioContext.addEventListener?.('statechange', onStateChange)
  attemptResume('recém-criado')

  return dispose
}

/**
 * Mede o nível de `track` e alimenta `createVadDecision`.
 *
 * Caminho principal: AudioWorklet (`vad-level-processor.js`), blocos de ~10 ms
 * na thread de áudio, entregues pela `port` — não congela com a janela oculta
 * nem minimizada, ao contrário do rAF de antes. O carregamento é assíncrono;
 * o monitor nasce na hora e começa a decidir no primeiro bloco.
 *
 * Fallback (worklet não carregou, ou carregou e não entrega nada): o
 * `AnalyserNode` de antes, com janela menor e `setInterval` de 20 ms no lugar
 * do rAF. Pior (o navegador espaça timers em segundo plano), mas nunca sem VAD.
 */
export function createVadMonitor(track: MediaStreamTrack, opts: VadMonitorOptions): VadMonitor {
  const label = opts.label ?? 'VAD'
  const decision = createVadDecision({
    autoSensitivity: opts.autoSensitivity,
    thresholdDb: opts.thresholdDb
  })

  const AudioContextCtor: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const audioContext = new AudioContextCtor()
  // ANTES de montar o grafo: um contexto parado torna todo o resto decorativo.
  const releaseContextKeeper = keepAudioContextRunning(audioContext)
  const mediaStream = new MediaStream([track])
  const source = audioContext.createMediaStreamSource(mediaStream)

  let stopped = false
  let speaking = false
  let blocksReceived = 0
  // Pico desde a última leitura entregue a `onLevel`.
  let peakDb = VAD_SILENCE_DB
  let lastReportMs: number | null = null

  let workletNode: AudioWorkletNode | null = null
  let workletSink: GainNode | null = null
  let watchdogId: ReturnType<typeof setInterval> | null = null
  let analyser: AnalyserNode | null = null
  let fallbackId: ReturnType<typeof setInterval> | null = null

  function onBlock(levelDb: number, nowMs: number): void {
    if (stopped) return
    blocksReceived++

    const next = decision.push(levelDb, nowMs)
    if (next !== speaking) {
      speaking = next
      opts.onSpeakingChange(next)
    }

    if (!opts.onLevel) return
    if (levelDb > peakDb) peakDb = levelDb
    const elapsed = lastReportMs === null ? Infinity : nowMs - lastReportMs
    // Relógio que voltou (ou NaN) também reporta, em vez de calar o medidor.
    if (elapsed >= 0 && elapsed < LEVEL_REPORT_INTERVAL_MS) return
    opts.onLevel({
      levelDb: clamp(peakDb, VAD_SILENCE_DB, VAD_MAX_DB),
      thresholdDb: decision.thresholdDb,
      speaking
    })
    peakDb = VAD_SILENCE_DB
    lastReportMs = nowMs
  }

  // O diagnóstico do checkpoint no Windows: UMA linha por monitor, nada por bloco.
  function logStart(path: string): void {
    const sensitivity = opts.autoSensitivity
      ? `automático (limiar inicial ${Math.round(decision.thresholdDb)} dB, segue o ruído)`
      : `manual (limiar ${Math.round(decision.thresholdDb)} dB)`
    console.info('[voice] %s: medindo via %s — modo %s', label, path, sensitivity)
  }

  function clearWatchdog(): void {
    if (watchdogId !== null) clearInterval(watchdogId)
    watchdogId = null
  }

  function teardownWorklet(): void {
    clearWatchdog()
    const node = workletNode
    workletNode = null
    if (node) {
      node.port.onmessage = null
      try {
        source.disconnect(node)
      } catch {
        // Já desconectado: nada a fazer.
      }
      node.disconnect()
    }
    workletSink?.disconnect()
    workletSink = null
  }

  function startFallback(reason: unknown): void {
    if (stopped || analyser !== null) return
    console.warn(
      '[voice] %s: AudioWorklet indisponível — usando AnalyserNode a cada %d ms (fallback; em ' +
        'segundo plano o navegador pode espaçar este timer)',
      label,
      FALLBACK_INTERVAL_MS,
      reason
    )
    const node = audioContext.createAnalyser()
    node.fftSize = FALLBACK_FFT_SIZE
    source.connect(node)
    analyser = node
    const buffer = new Float32Array(node.fftSize)
    fallbackId = setInterval(() => {
      if (stopped) return
      node.getFloatTimeDomainData(buffer)
      let sumOfSquares = 0
      for (let i = 0; i < buffer.length; i++) sumOfSquares += buffer[i] * buffer[i]
      onBlock(rmsToDb(Math.sqrt(sumOfSquares / buffer.length)), performance.now())
    }, FALLBACK_INTERVAL_MS)
    logStart(`AnalyserNode a cada ${FALLBACK_INTERVAL_MS} ms (fallback)`)
  }

  // Worklet carregado mas mudo, com o contexto RODANDO (contexto parado é
  // assunto de `keepAudioContextRunning`, não do worklet): troca para o
  // fallback em vez de deixar o microfone travado no último estado.
  function armWatchdog(): void {
    let strikes = 0
    watchdogId = setInterval(() => {
      if (stopped || blocksReceived > 0) {
        clearWatchdog()
        return
      }
      if (audioContext.state !== 'running') {
        strikes = 0
        return
      }
      strikes++
      if (strikes < WORKLET_WATCHDOG_STRIKES) return
      teardownWorklet()
      startFallback(
        new Error(
          `o worklet carregou mas não entregou nenhum bloco em ~${
            WORKLET_WATCHDOG_STRIKES * WORKLET_WATCHDOG_INTERVAL_MS
          } ms com o contexto rodando`
        )
      )
    }, WORKLET_WATCHDOG_INTERVAL_MS)
  }

  async function startWorklet(): Promise<void> {
    const worklet = audioContext.audioWorklet
    if (!worklet) throw new Error('AudioContext sem audioWorklet (contexto não seguro?)')
    await worklet.addModule(levelProcessorUrl)
    if (stopped) return

    const node = new AudioWorkletNode(audioContext, VAD_LEVEL_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      // Mixa o microfone para mono ANTES do worklet: ele lê só o canal 0.
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers'
    })
    // Registrado ANTES de qualquer `connect`: se um deles lançar, o `catch`
    // de quem chamou desmonta o que já existe via `teardownWorklet()`.
    workletNode = node
    node.port.onmessage = (event: MessageEvent): void => {
      const data = event.data as { type?: unknown; db?: unknown; t?: unknown } | null
      if (!data || data.type !== 'level') return
      if (typeof data.db !== 'number' || typeof data.t !== 'number') return
      onBlock(data.db, data.t)
    }

    // Ganho ZERO até o destination: garante que o Chromium "puxe" o nó a cada
    // render quantum (um nó solto pode não ser processado), sem tocar nada. O
    // worklet nem escreve na saída — é silêncio multiplicado por zero.
    const sink = audioContext.createGain()
    workletSink = sink
    sink.gain.value = 0
    source.connect(node)
    node.connect(sink)
    sink.connect(audioContext.destination)

    armWatchdog()
    logStart('AudioWorklet (blocos de 10 ms)')
  }

  void startWorklet().catch((err: unknown) => {
    teardownWorklet()
    startFallback(err)
  })

  return {
    stop(): void {
      if (stopped) return
      stopped = true
      if (fallbackId !== null) clearInterval(fallbackId)
      fallbackId = null
      teardownWorklet()
      // Solta os listeners de `statechange` e de gesto ANTES de fechar: um
      // listener no `document` sobrevive ao contexto e vazaria a cada
      // abrir/fechar do painel de configurações.
      releaseContextKeeper()
      source.disconnect()
      analyser?.disconnect()
      // `close()` é assíncrono e pode rejeitar se o contexto já estiver
      // fechado (ex.: chamado duas vezes) — best-effort, nunca deve lançar
      // para quem chamou `stop()`.
      void audioContext.close().catch(() => {})
    },
    setThreshold(thresholdDb: number): void {
      decision.setThresholdDb(thresholdDb)
    },
    setAutoSensitivity(on: boolean): void {
      decision.setAutoSensitivity(on)
    }
  }
}
