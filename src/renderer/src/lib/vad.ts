// Motor de detecção de voz (Plano 07-05): puro Web Audio API, independente
// de React, sem dependência do `livekit-client` — recebe um `MediaStreamTrack`
// cru (a track de captura local, a mesma que o SDK publica) e decide quando
// o nível de áudio cruza um limiar configurável. `VoiceProvider` é quem
// decide o que fazer com `onSpeakingChange` (ligar/desligar o microfone
// publicado); este módulo não conhece LiveKit.

export type VadMonitorOptions = {
  /** Nível RMS (0-1) acima do qual consideramos que há fala. */
  threshold: number
  onSpeakingChange: (speaking: boolean) => void
  /**
   * Tempo (ms) que o nível precisa ficar abaixo do limiar antes de disparar
   * `onSpeakingChange(false)` — evita cortar o microfone no meio de uma
   * pausa curta de respiração. Cruzar de baixo pra cima dispara
   * `onSpeakingChange(true)` imediatamente, sem hold.
   */
  holdMs?: number
  /**
   * Callback opcional chamado a cada frame com o nível RMS atual (0-1) —
   * usado pelo painel de configurações para desenhar um medidor de volume
   * ao vivo sem precisar duplicar a leitura do `AnalyserNode`.
   */
  onLevel?: (level: number) => void
}

export type VadMonitor = {
  stop: () => void
  setThreshold: (value: number) => void
}

const DEFAULT_HOLD_MS = 300

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

export function createVadMonitor(track: MediaStreamTrack, opts: VadMonitorOptions): VadMonitor {
  const holdMs = opts.holdMs ?? DEFAULT_HOLD_MS
  let threshold = opts.threshold

  const AudioContextCtor: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const audioContext = new AudioContextCtor()
  // ANTES de montar o grafo: um contexto parado torna todo o resto decorativo.
  const releaseContextKeeper = keepAudioContextRunning(audioContext)
  const mediaStream = new MediaStream([track])
  const source = audioContext.createMediaStreamSource(mediaStream)
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 2048
  source.connect(analyser)

  const timeDomainBuffer = new Float32Array(analyser.fftSize)

  let speaking = false
  let stopped = false
  let rafId: number | null = null
  // Timestamp (performance.now()) desde quando o nível está abaixo do
  // limiar de forma contínua; `null` enquanto está acima ou já não fala.
  let belowSinceMs: number | null = null

  function rmsLevel(): number {
    analyser.getFloatTimeDomainData(timeDomainBuffer)
    let sumOfSquares = 0
    for (let i = 0; i < timeDomainBuffer.length; i++) {
      sumOfSquares += timeDomainBuffer[i] * timeDomainBuffer[i]
    }
    return Math.sqrt(sumOfSquares / timeDomainBuffer.length)
  }

  function tick(): void {
    if (stopped) return

    const level = rmsLevel()
    opts.onLevel?.(level)
    const isAboveThreshold = level >= threshold

    if (isAboveThreshold) {
      belowSinceMs = null
      if (!speaking) {
        speaking = true
        opts.onSpeakingChange(true)
      }
    } else if (speaking) {
      const now = performance.now()
      if (belowSinceMs === null) {
        belowSinceMs = now
      } else if (now - belowSinceMs >= holdMs) {
        speaking = false
        belowSinceMs = null
        opts.onSpeakingChange(false)
      }
    }

    rafId = requestAnimationFrame(tick)
  }

  rafId = requestAnimationFrame(tick)

  return {
    stop(): void {
      if (stopped) return
      stopped = true
      if (rafId !== null) cancelAnimationFrame(rafId)
      // Solta os listeners de `statechange` e de gesto ANTES de fechar: um
      // listener no `document` sobrevive ao contexto e vazaria a cada
      // abrir/fechar do painel de configurações.
      releaseContextKeeper()
      source.disconnect()
      analyser.disconnect()
      // `close()` é assíncrono e pode rejeitar se o contexto já estiver
      // fechado (ex.: chamado duas vezes) — best-effort, nunca deve lançar
      // para quem chamou `stop()`.
      void audioContext.close().catch(() => {})
    },
    setThreshold(value: number): void {
      threshold = value
    }
  }
}
