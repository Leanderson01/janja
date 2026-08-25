// Prova do AudioWorkletProcessor do áudio de compartilhamento (Fase 8.6).
//
// O teste avalia O ARQUIVO REAL (`?raw` + `new Function`), não uma cópia da
// lógica: `screenshare-audio-processor.js` roda no AudioWorkletGlobalScope, um
// reino sem `import`/`export`, e nenhum ambiente de teste tem Web Audio (nem
// jsdom, nem edge-runtime, nem o WSL2 onde isto roda — não há placa de som,
// não há `AudioContext`). Duplicar a lógica num arquivo `.ts` "testável" seria
// provar a cópia e embarcar o original.
//
// O que ESTE arquivo prova: a máquina de estados do ring buffer — priming,
// fome e saturação. O que ele NÃO prova está no SUMMARY: que o Chromium
// carrega este asset sob a CSP `script-src 'self'`, e que o relógio do
// dispositivo virtual de process loopback não deriva do relógio do
// AudioContext ao longo de 10 minutos. Isso é do checkpoint 08.6-06.
import { describe, it, expect } from 'vitest'
import source from './screenshare-audio-processor.js?raw'

type ProcessorPort = {
  postMessage: (message: unknown) => void
  onmessage: ((event: { data: unknown }) => void) | null
}

type ProcessorInstance = {
  port: ProcessorPort
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
  available: number
  priming: boolean
  underruns: number
  overruns: number
  framesDropped: number
  framesPlayed: number
}

type ProcessorCtor = (new () => ProcessorInstance) & {
  RING_FRAMES: number
  PRIME_FRAMES: number
}

type LoadedWorklet = {
  name: string
  Ctor: ProcessorCtor
  /** Tudo que o processador postou de volta pela porta. */
  posted: unknown[]
}

/**
 * Avalia o worklet num sandbox com as três coisas que o
 * AudioWorkletGlobalScope fornece e nenhum outro ambiente fornece:
 * a classe base, a função de registro e a taxa de amostragem global.
 */
function loadWorklet(): LoadedWorklet {
  const posted: unknown[] = []

  class FakeAudioWorkletProcessor {
    port: ProcessorPort
    constructor() {
      this.port = {
        postMessage: (message: unknown): void => {
          posted.push(message)
        },
        onmessage: null
      }
    }
  }

  const registry: { name: string; Ctor: ProcessorCtor | null } = { name: '', Ctor: null }
  const registerProcessor = (name: string, Ctor: ProcessorCtor): void => {
    registry.name = name
    registry.Ctor = Ctor
  }

  const evaluate = new Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    'sampleRate',
    'currentTime',
    source
  )
  evaluate(FakeAudioWorkletProcessor, registerProcessor, 48000, 0)

  const Ctor = registry.Ctor
  if (!Ctor) throw new Error('O worklet não chamou registerProcessor()')
  return { name: registry.name, Ctor, posted }
}

/** Um render quantum de saída estéreo, como o motor de áudio entrega. */
function quantum(frames = 128): Float32Array[][] {
  return [[new Float32Array(frames), new Float32Array(frames)]]
}

/** Rampa determinística: o valor de cada frame é o seu índice global. */
function ramp(frames: number, offset = 0): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    left[i] = offset + i
    right[i] = -(offset + i)
  }
  return { left, right }
}

function push(player: ProcessorInstance, left: Float32Array, right: Float32Array): void {
  if (!player.port.onmessage) throw new Error('O worklet não instalou port.onmessage')
  player.port.onmessage({ data: { type: 'chunk', left: left.buffer, right: right.buffer } })
}

function isAllZeros(channel: Float32Array): boolean {
  return channel.every((sample) => sample === 0)
}

describe('screenshare-audio-processor (o arquivo real, avaliado em sandbox)', () => {
  it('registra-se com o nome que o bridge usa e sem sintaxe de módulo', () => {
    const { name } = loadWorklet()
    expect(name).toBe('screenshare-pcm-player')

    // `addModule()` avalia o arquivo no AudioWorkletGlobalScope, que não tem
    // resolvedor de módulos do app: um `import` aqui seria erro em runtime,
    // dentro do Chromium, com o sintoma "sem áudio".
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/^\s*export\s/m)
  })

  it('1. antes do priming, produz só zeros mesmo com dado disponível', () => {
    const { Ctor } = loadWorklet()
    const player = new Ctor()
    const { left, right } = ramp(Ctor.PRIME_FRAMES - 1)
    push(player, left, right)

    const out = quantum()
    expect(player.process([], out)).toBe(true)
    expect(isAllZeros(out[0][0])).toBe(true)
    expect(isAllZeros(out[0][1])).toBe(true)
    // O dado continua no buffer: priming atrasa, não descarta.
    expect(player.available).toBe(Ctor.PRIME_FRAMES - 1)
  })

  it('2. depois de PRIME_FRAMES, toca as amostras na ordem de entrada, nos dois canais', () => {
    const { Ctor } = loadWorklet()
    const player = new Ctor()
    const { left, right } = ramp(Ctor.PRIME_FRAMES)
    push(player, left, right)

    const out = quantum()
    expect(player.process([], out)).toBe(true)
    for (let i = 0; i < 128; i++) {
      expect(out[0][0][i]).toBe(i)
      expect(out[0][1][i]).toBe(-i)
    }

    // E o quantum seguinte continua de onde parou — sem repetir nem pular.
    const out2 = quantum()
    player.process([], out2)
    for (let i = 0; i < 128; i++) {
      expect(out2[0][0][i]).toBe(128 + i)
    }
    expect(player.available).toBe(Ctor.PRIME_FRAMES - 256)
  })

  it('3. FOME: consumir tudo e pedir mais produz zeros, sem lançar, e process segue true', () => {
    const { Ctor } = loadWorklet()
    const player = new Ctor()
    const { left, right } = ramp(Ctor.PRIME_FRAMES)
    push(player, left, right)

    // 2880 frames / 128 = 22 quanta cheios + 64 frames de sobra.
    for (let i = 0; i < 22; i++) {
      expect(player.process([], quantum())).toBe(true)
    }
    expect(player.available).toBe(64)
    expect(player.underruns).toBe(0)

    const out = quantum()
    expect(() => player.process([], out)).not.toThrow()
    expect(player.process([], quantum())).toBe(true)
    expect(isAllZeros(out[0][0])).toBe(true)
    expect(isAllZeros(out[0][1])).toBe(true)
    expect(player.underruns).toBeGreaterThanOrEqual(1)
  })

  it('4. depois de uma fome, o buffer volta a exigir priming antes de tocar', () => {
    const { Ctor } = loadWorklet()
    const player = new Ctor()
    const primed = ramp(Ctor.PRIME_FRAMES)
    push(player, primed.left, primed.right)
    for (let i = 0; i < 23; i++) player.process([], quantum()) // o 23º é a fome
    expect(player.priming).toBe(true)

    // Um chunk pequeno NÃO destrava: ainda falta folga para o priming.
    const small = ramp(256, 100000)
    push(player, small.left, small.right)
    const out = quantum()
    player.process([], out)
    expect(isAllZeros(out[0][0])).toBe(true)
    expect(player.priming).toBe(true)

    // Com folga suficiente, volta a tocar.
    const big = ramp(Ctor.PRIME_FRAMES, 200000)
    push(player, big.left, big.right)
    const out2 = quantum()
    player.process([], out2)
    expect(isAllZeros(out2[0][0])).toBe(false)
    expect(player.priming).toBe(false)
  })

  it('5. SATURAÇÃO: escrever mais que RING_FRAMES descarta o MAIS ANTIGO', () => {
    const { Ctor } = loadWorklet()
    const player = new Ctor()
    const excess = 1000
    const { left, right } = ramp(Ctor.RING_FRAMES + excess)
    push(player, left, right)

    // Nunca cresce além da capacidade.
    expect(player.available).toBe(Ctor.RING_FRAMES)
    expect(player.overruns).toBe(1)
    expect(player.framesDropped).toBe(excess)

    // O que sai é o FIM do que entrou, não o começo.
    const out = quantum()
    player.process([], out)
    for (let i = 0; i < 128; i++) {
      expect(out[0][0][i]).toBe(excess + i)
    }
  })

  it('5b. SATURAÇÃO em rajadas sucessivas: a profundidade nunca passa da capacidade', () => {
    const { Ctor } = loadWorklet()
    const player = new Ctor()
    for (let burst = 0; burst < 10; burst++) {
      const { left, right } = ramp(5000, burst * 5000)
      push(player, left, right)
      expect(player.available).toBeLessThanOrEqual(Ctor.RING_FRAMES)
    }
    expect(player.available).toBe(Ctor.RING_FRAMES)

    // 50000 frames entraram, 24000 couberam: sobra o FIM (26000..49999).
    const out = quantum()
    player.process([], out)
    expect(out[0][0][0]).toBe(50000 - Ctor.RING_FRAMES)
  })

  it('6. flush esvazia e volta ao priming', () => {
    const { Ctor } = loadWorklet()
    const player = new Ctor()
    const { left, right } = ramp(Ctor.PRIME_FRAMES * 2)
    push(player, left, right)
    player.process([], quantum())
    expect(player.priming).toBe(false)

    player.port.onmessage?.({ data: { type: 'flush' } })
    expect(player.available).toBe(0)
    expect(player.priming).toBe(true)

    const out = quantum()
    expect(player.process([], out)).toBe(true)
    expect(isAllZeros(out[0][0])).toBe(true)
  })

  it('7. process NUNCA devolve false — nem vazio, nem cheio, nem malformado', () => {
    const { Ctor } = loadWorklet()
    const player = new Ctor()
    const results: boolean[] = []

    results.push(player.process([], quantum())) // buffer vazio
    const { left, right } = ramp(Ctor.RING_FRAMES * 2)
    push(player, left, right)
    for (let i = 0; i < 300; i++) results.push(player.process([], quantum())) // esvazia até a fome
    results.push(player.process([], [[]])) // saída sem canais
    results.push(player.process([], [])) // saída sem nada
    results.push(player.process([], quantum(1)))
    results.push(player.process([], [[new Float32Array(128)]])) // saída mono

    expect(results.every((r) => r === true)).toBe(true)
    expect(results.length).toBeGreaterThan(300)
  })

  it('8. mensagem malformada na porta é ignorada, sem lançar e sem sujar o buffer', () => {
    const { Ctor } = loadWorklet()
    const player = new Ctor()
    const post = player.port.onmessage
    if (!post) throw new Error('sem onmessage')

    expect(() => {
      post({ data: { type: 'chunk' } }) // sem `left`
      post({ data: { type: 'quem-sabe' } }) // tipo desconhecido
      post({ data: null })
      post({ data: 'texto solto' })
      post({ data: { type: 'chunk', left: 'nada disso' } })
      post({ data: { type: 'chunk', left: new Float32Array(0).buffer } })
    }).not.toThrow()

    expect(player.available).toBe(0)
    expect(player.process([], quantum())).toBe(true)
  })

  it('8b. chunk sem canal direito degrada para mono duplicado em vez de sumir', () => {
    const { Ctor } = loadWorklet()
    const player = new Ctor()
    const { left } = ramp(Ctor.PRIME_FRAMES)
    player.port.onmessage?.({ data: { type: 'chunk', left: left.buffer } })
    expect(player.available).toBe(Ctor.PRIME_FRAMES)

    const out = quantum()
    player.process([], out)
    expect(out[0][0][10]).toBe(10)
    expect(out[0][1][10]).toBe(10)
  })

  it('reporta stats pela porta — o único instrumento de deriva do checkpoint em Windows', () => {
    const { Ctor, posted } = loadWorklet()
    const player = new Ctor()
    const { left, right } = ramp(Ctor.RING_FRAMES)
    push(player, left, right)

    // 48000 frames renderados = ~1 s a 48 kHz.
    for (let i = 0; i < 48000 / 128; i++) player.process([], quantum())

    const stats = posted.filter(
      (m): m is Record<string, number | string> =>
        typeof m === 'object' && m !== null && (m as { type?: string }).type === 'stats'
    )
    expect(stats.length).toBeGreaterThanOrEqual(1)
    const last = stats[stats.length - 1]
    expect(last.framesRendered).toBe(48000)
    // 24000 frames = 187 quanta de 128 + 64 de sobra. A fome é tudo-ou-nada
    // (128 zeros, não 64 amostras + 64 zeros), então os 64 finais ficam no
    // buffer esperando companhia — é o que `depth` mostra.
    expect(last.framesPlayed).toBe(Ctor.RING_FRAMES - 64)
    expect(last.depth).toBe(64)
    expect(last.underruns).toBeGreaterThanOrEqual(1) // 24000 frames < 48000 pedidos
  })
})
