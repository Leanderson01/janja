/*
 * `AudioWorkletProcessor`, `registerProcessor` e `sampleRate` são globais do
 * AudioWorkletGlobalScope — mesmo arranjo de `screenshare-audio-processor.js`:
 * nada de `/* global ... *\/` (o ESLint já os conhece e redeclarar vira
 * `no-redeclare`), e o disable abaixo é o preço de o arquivo ser `.js` puro.
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
//
// AudioWorkletProcessor do MEDIDOR DE NÍVEL do detector de voz.
//
// POR QUE UM WORKLET
// ------------------
// O laço antigo media dentro de `requestAnimationFrame`. O Chromium PARA o rAF
// com a janela minimizada ou oculta (o Electron com `backgroundThrottling`
// padrão, e qualquer aba em segundo plano na web): com o janja atrás de um
// jogo, o VAD congelava no último estado — aberto transmitindo, ou fechado
// cortando a pessoa. O worklet roda na thread de áudio, no relógio do
// AudioContext, e não depende de a janela estar visível.
//
// POR QUE `.js` E SEM `import`/`export`
// -------------------------------------
// Ele não é módulo do app: `vad.ts` o carrega em runtime com
// `audioWorklet.addModule(url)`, e ele é avaliado em outro reino (sem DOM, sem
// os módulos do bundle). A CSP do app é `script-src 'self'`: o arquivo PRECISA
// sair como asset real servido da própria origem, nunca `data:`/`blob:` — por
// isso `vad.ts` o importa com `?url&no-inline`, que vale nos dois alvos (o web
// não tem `assetsInlineLimit: 0`). Ver também `screenshare-audio-processor.js`.
//
// O QUE ELE FAZ, E SÓ ISSO
// ------------------------
// A cada ~10 ms de áudio (sampleRate/100 frames: 480 a 48 kHz, 441 a 44,1 kHz)
// calcula o RMS do bloco, converte para dBFS (piso −100) e posta
// `{ type: 'level', db, t }` pela porta, onde `t` é o fim do bloco em ms no
// relógio de áudio (frames contados / sampleRate). A DECISÃO de abrir/fechar
// não mora aqui: é `createVadDecision`, em `vad.ts`, pura e testada.

/** Piso do medidor, igual a `VAD_SILENCE_DB` de `vad.ts`. */
const SILENCE_DB = -100

/** Um render quantum do Web Audio — o tamanho de um `process()` sem entrada. */
const RENDER_QUANTUM = 128

class VadLevelMeter extends AudioWorkletProcessor {
  constructor() {
    super()

    /** ~10 ms de áudio, qualquer que seja a taxa do contexto. */
    this.blockFrames = Math.max(1, Math.round(sampleRate / 100))
    this.sumOfSquares = 0
    this.blockFill = 0
    /** Relógio do medidor: frames vistos desde o nascimento do nó. */
    this.framesTotal = 0
  }

  process(inputs) {
    // SEMPRE `return true`: `false` mata o nó em definitivo e o VAD ficaria
    // sem nível nenhum — microfone travado no último estado, sem erro.
    try {
      this.measure(inputs)
    } catch {
      // ignorado de propósito; ver acima
    }
    return true
  }

  measure(inputs) {
    const input = inputs && inputs[0]
    const samples = input && input.length > 0 ? input[0] : null

    // Entrada sem nó ativo chega como array VAZIO. Conta como silêncio em vez
    // de pular: pular congelaria o relógio da decisão, e um microfone aberto
    // nunca chegaria aos 600 ms de soltura.
    const frames = samples ? samples.length : RENDER_QUANTUM

    for (let i = 0; i < frames; i++) {
      const sample = samples ? samples[i] : 0
      this.sumOfSquares += sample * sample
      this.blockFill++
      this.framesTotal++
      if (this.blockFill >= this.blockFrames) this.flush()
    }
  }

  flush() {
    const rms = Math.sqrt(this.sumOfSquares / this.blockFill)
    // `rms > 0` também barra NaN (amostra corrompida): vira silêncio, não lixo.
    const db = rms > 0 ? Math.min(0, Math.max(SILENCE_DB, 20 * Math.log10(rms))) : SILENCE_DB
    this.port.postMessage({ type: 'level', db, t: (this.framesTotal / sampleRate) * 1000 })
    this.sumOfSquares = 0
    this.blockFill = 0
  }
}

registerProcessor('vad-level-meter', VadLevelMeter)
