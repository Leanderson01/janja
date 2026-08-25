/*
 * `AudioWorkletProcessor`, `registerProcessor` e `sampleRate` são globais do
 * AudioWorkletGlobalScope. NÃO existe `/* global ... *\/` aqui de propósito: o
 * ESLint deste projeto já os conhece como built-ins do browser, e declará-los
 * de novo vira `no-redeclare` (3 erros).
 *
 * O disable abaixo é o preço de o arquivo ser `.js` de verdade (ver o bloco
 * seguinte): a regra `explicit-function-return-type` do preset TS não tem como
 * ser satisfeita em JS puro, e JS puro é requisito de execução, não escolha.
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
//
// AudioWorkletProcessor do áudio de compartilhamento por processo (Fase 8.6).
//
// POR QUE ESTE ARQUIVO É `.js` E NÃO `.ts`
// ----------------------------------------
// Ele não é um módulo do app: é buscado em RUNTIME por
// `audioWorklet.addModule(url)` e avaliado dentro do AudioWorkletGlobalScope,
// que é outro reino — sem DOM, sem `window`, sem os módulos do bundle. O
// bundler só participa emitindo este arquivo como ASSET (o bridge o importa
// com `?url`, e `assetsInlineLimit: 0` em electron.vite.config.ts garante que
// ele vira um `.js` de verdade no disco em vez de um `data:` URI).
//
// Isso não é preferência de estilo, é a CSP do app: `script-src 'self'`
// (src/renderer/index.html). O Chromium BLOQUEIA `data:` e `blob:` como fonte
// de script, e `addModule()` falha — o compartilhamento sai sem som, sem erro
// de aplicação nenhum. É a lição nº 2 do HANDOFF com outro nome (a CSP do
// template recusando o WebSocket do Convex, sem erro, na Fase 2).
// **A CSP não se afrouxa. Quem se adapta é o caminho do asset.**
//
// Por isso aqui não há `import`, não há `export` e não há sintaxe de módulo:
// nada além de JS que o AudioWorkletGlobalScope entende sozinho.

/** 500 ms a 48 kHz. Teto RÍGIDO: o buffer nunca cresce além disto. */
const RING_FRAMES = 24000

/**
 * 60 ms. Quanto acumular antes de começar a tocar.
 *
 * Alvo de 40–80 ms (§6.2 da pesquisa): menos que isso e cada engasgo do IPC
 * vira clique audível; mais que isso e o áudio descola visivelmente do vídeo.
 */
const PRIME_FRAMES = 2880

/** Um render quantum do Web Audio. Só usado para o log de stats. */
const RENDER_QUANTUM = 128

/** ~1 s de frames renderados entre relatórios de stats. */
const STATS_INTERVAL_FRAMES = 48000

/**
 * Toca PCM que chega em RAJADAS (IPC) num motor que consome em ritmo FIXO
 * (128 frames por render quantum, ~2,7 ms). Os dois relógios não são o mesmo
 * — e, no caso do process loopback, nem se sabe a que relógio o dispositivo
 * virtual está preso (confiança LOW na pesquisa; só medindo em Windows). Por
 * isso existem políticas nos DOIS extremos, e não em um só.
 */
class ScreenSharePcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super()

    this.left = new Float32Array(RING_FRAMES)
    this.right = new Float32Array(RING_FRAMES)
    this.readIndex = 0
    this.writeIndex = 0
    /** Frames prontos para tocar. Nunca passa de RING_FRAMES, por construção. */
    this.available = 0

    /**
     * POLÍTICA 1 — PRIMING. Enquanto `true`, a saída é silêncio, mesmo com
     * dado disponível. Evita o defeito de começar a tocar com 3 ms no buffer:
     * o primeiro trecho sairia picotado, porque o primeiro chunk chega antes
     * de o fluxo estabilizar.
     */
    this.priming = true

    this.underruns = 0
    this.overruns = 0
    this.framesDropped = 0
    this.framesPlayed = 0
    this.framesRendered = 0
    this.framesSinceStats = 0

    this.port.onmessage = (event) => {
      this.handleMessage(event && event.data)
    }
  }

  /**
   * Tolerante de propósito: mensagem malformada é IGNORADA, nunca lançada.
   * Uma exceção aqui mataria o nó e, com ele, a track já publicada — ou seja,
   * um chunk torto derrubaria a transmissão inteira.
   */
  handleMessage(data) {
    if (!data || typeof data !== 'object') return

    if (data.type === 'flush') {
      this.reset()
      return
    }

    if (data.type !== 'chunk') return
    if (!data.left) return

    try {
      const left = new Float32Array(data.left)
      // `right` ausente degrada para mono duplicado em vez de descartar o
      // chunk: meio áudio é melhor que um buraco, e é o mesmo tratamento que
      // `int16ToPlanarFloat32` dá a uma captura de 1 canal.
      const right = data.right ? new Float32Array(data.right) : left
      this.write(left, right)
    } catch {
      // ArrayBuffer já transferido/destacado, tamanho não múltiplo de 4, etc.
      // Descartar o chunk é a resposta certa; morrer não é.
    }
  }

  /**
   * POLÍTICA 3 — SATURAÇÃO (overrun). Chegou mais do que cabe: DESCARTA O
   * MAIS ANTIGO avançando `readIndex`. Nunca realoca, nunca cresce.
   *
   * O defeito que isto evita é o pior dos dois: um buffer que cresce sem
   * limite consome memória para sempre E aumenta a latência monotonicamente —
   * o áudio vai atrasando em relação ao vídeo, minuto após minuto, sem nunca
   * dar erro. Descartar o mais antigo custa um clique e mantém a latência
   * presa ao teto.
   */
  write(left, right) {
    const frames = Math.min(left.length, right.length)
    if (frames <= 0) return

    // Chunk maior que o anel inteiro: só o FIM dele pode sobreviver.
    const start = frames > RING_FRAMES ? frames - RING_FRAMES : 0
    const incoming = frames - start

    let dropped = start
    const free = RING_FRAMES - this.available
    if (incoming > free) {
      const overflow = incoming - free
      this.readIndex = (this.readIndex + overflow) % RING_FRAMES
      this.available -= overflow
      dropped += overflow
    }

    if (dropped > 0) {
      this.overruns++
      this.framesDropped += dropped
    }

    for (let i = 0; i < incoming; i++) {
      this.left[this.writeIndex] = left[start + i]
      this.right[this.writeIndex] = right[start + i]
      this.writeIndex = this.writeIndex + 1 === RING_FRAMES ? 0 : this.writeIndex + 1
    }
    this.available += incoming
  }

  reset() {
    this.left.fill(0)
    this.right.fill(0)
    this.readIndex = 0
    this.writeIndex = 0
    this.available = 0
    this.priming = true
  }

  process(_inputs, outputs) {
    // Tudo dentro de try/catch e SEMPRE `return true`: devolver `false` mata o
    // nó em definitivo, e a MediaStreamTrack publicada morre junto — sem erro,
    // sem reconexão, sem nada. Nenhum defeito deste arquivo vale isso.
    try {
      this.render(outputs)
    } catch {
      // ignorado de propósito; ver acima
    }
    return true
  }

  render(outputs) {
    const output = outputs && outputs[0]
    if (!output || output.length === 0) return

    const outLeft = output[0]
    const outRight = output.length > 1 ? output[1] : null
    const needed = outLeft.length

    this.framesRendered += needed
    this.framesSinceStats += needed
    if (this.framesSinceStats >= STATS_INTERVAL_FRAMES) {
      this.framesSinceStats = 0
      this.reportStats()
    }

    if (this.priming) {
      if (this.available < PRIME_FRAMES) {
        this.silence(outLeft, outRight)
        return
      }
      this.priming = false
    }

    // POLÍTICA 2 — FOME (underrun). Não há frames suficientes: SILÊNCIO, e
    // volta ao priming.
    //
    // Isto NÃO é caso raro nem paliativo: o addon nativo DESCARTA buffers
    // silenciosos (`IsBufferSilent`, -70 dBFS), então durante um trecho quieto
    // não chega callback nenhum — a fome é o comportamento normal do silêncio.
    // Um desenho que concatenasse chunks assumindo fluxo contínuo faria o
    // áudio ACELERAR (tocaria o próximo som cedo demais, colado no anterior).
    // Preencher com zeros é o que mantém o tempo correndo no ritmo do relógio
    // do AudioContext, que é o único relógio confiável aqui.
    if (this.available < needed) {
      this.underruns++
      this.priming = true
      this.silence(outLeft, outRight)
      return
    }

    for (let i = 0; i < needed; i++) {
      outLeft[i] = this.left[this.readIndex]
      if (outRight) outRight[i] = this.right[this.readIndex]
      this.readIndex = this.readIndex + 1 === RING_FRAMES ? 0 : this.readIndex + 1
    }
    this.available -= needed
    this.framesPlayed += needed
  }

  silence(outLeft, outRight) {
    outLeft.fill(0)
    if (outRight) outRight.fill(0)
  }

  /**
   * O único instrumento que o checkpoint humano (08.6-06) vai ter para medir
   * deriva de relógio ao longo de 10 minutos num Windows real: `depth` subindo
   * sem parar significa que a captura entrega mais rápido que o AudioContext
   * consome; `underruns` crescendo fora do silêncio significa o contrário.
   */
  reportStats() {
    this.port.postMessage({
      type: 'stats',
      underruns: this.underruns,
      overruns: this.overruns,
      framesDropped: this.framesDropped,
      framesPlayed: this.framesPlayed,
      framesRendered: this.framesRendered,
      depth: this.available,
      /** Profundidade em ms, que é como um humano lê latência. */
      depthMs: (this.available / sampleRate) * 1000,
      quantum: RENDER_QUANTUM
    })
  }
}

// Os limiares ficam legíveis de fora para que o TESTE não os duplique: se
// alguém mexer em RING_FRAMES ou PRIME_FRAMES, o teste acompanha em vez de
// virar mentira silenciosa.
ScreenSharePcmPlayer.RING_FRAMES = RING_FRAMES
ScreenSharePcmPlayer.PRIME_FRAMES = PRIME_FRAMES

registerProcessor('screenshare-pcm-player', ScreenSharePcmPlayer)
