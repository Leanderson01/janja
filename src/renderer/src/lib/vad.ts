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

export function createVadMonitor(track: MediaStreamTrack, opts: VadMonitorOptions): VadMonitor {
  const holdMs = opts.holdMs ?? DEFAULT_HOLD_MS
  let threshold = opts.threshold

  const AudioContextCtor: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const audioContext = new AudioContextCtor()
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
