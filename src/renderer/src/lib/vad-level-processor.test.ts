// Prova do AudioWorkletProcessor do medidor do VAD (`vad-level-processor.js`).
//
// Avalia O ARQUIVO REAL (`?raw` + `new Function`), como
// `screenshare-audio-processor.test.ts`: o worklet roda num reino sem
// `import`/`export` e nenhum ambiente de teste tem Web Audio. O que ESTE
// arquivo prova: o tamanho do bloco (~10 ms em qualquer taxa), o RMS em dBFS,
// o relógio em ms e que nada ali dentro derruba o nó. O que ele NÃO prova: que
// o Chromium chama `process()` com a janela oculta — isso é do teste na call.
import { describe, expect, it } from 'vitest'

import source from './vad-level-processor.js?raw'

type LevelMessage = { type: string; db: number; t: number }

type ProcessorInstance = {
  process(inputs: unknown): boolean
}

function loadWorklet(sampleRate: number): {
  name: string
  processor: ProcessorInstance
  posted: LevelMessage[]
} {
  const posted: LevelMessage[] = []

  class FakeAudioWorkletProcessor {
    port = {
      postMessage: (message: LevelMessage): void => {
        posted.push(message)
      },
      onmessage: null
    }
  }

  const registry: { name: string; Ctor: (new () => ProcessorInstance) | null } = {
    name: '',
    Ctor: null
  }
  const registerProcessor = (name: string, Ctor: new () => ProcessorInstance): void => {
    registry.name = name
    registry.Ctor = Ctor
  }

  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', source)(
    FakeAudioWorkletProcessor,
    registerProcessor,
    sampleRate
  )
  if (!registry.Ctor) throw new Error('o worklet não chamou registerProcessor')

  return { name: registry.name, processor: new registry.Ctor(), posted }
}

/** `quanta` render quanta de 128 frames, mono, com amostra constante. */
function feedConstant(processor: ProcessorInstance, sample: number, quanta: number): void {
  for (let q = 0; q < quanta; q++) {
    processor.process([[new Float32Array(128).fill(sample)]])
  }
}

describe('vad-level-processor.js', () => {
  it('registra o nome que vad.ts usa', () => {
    expect(loadWorklet(48000).name).toBe('vad-level-meter')
  })

  it('a 48 kHz, um bloco a cada 480 frames (10 ms), com o tempo do fim do bloco', () => {
    const { processor, posted } = loadWorklet(48000)

    // 15 quanta = 1920 frames = 4 blocos de 480.
    feedConstant(processor, 0.1, 15)

    expect(posted).toHaveLength(4)
    expect(posted.map((m) => m.type)).toEqual(['level', 'level', 'level', 'level'])
    expect(posted.map((m) => m.t)).toEqual([10, 20, 30, 40])
  })

  it('a 44,1 kHz o bloco continua sendo ~10 ms (441 frames)', () => {
    const { processor, posted } = loadWorklet(44100)

    feedConstant(processor, 0.1, 7) // 896 frames = 2 blocos de 441

    expect(posted).toHaveLength(2)
    expect(posted[0].t).toBeCloseTo(10, 6)
  })

  it('RMS em dBFS: amplitude constante 0,1 => −20 dB; 1 => 0 dB', () => {
    const { processor, posted } = loadWorklet(48000)

    feedConstant(processor, 0.1, 4)
    expect(posted[0].db).toBeCloseTo(-20, 4)

    const loud = loadWorklet(48000)
    feedConstant(loud.processor, 1, 4)
    expect(loud.posted[0].db).toBeCloseTo(0, 6)
  })

  it('silêncio sai como −100, nunca −Infinity', () => {
    const { processor, posted } = loadWorklet(48000)

    feedConstant(processor, 0, 4)

    expect(posted[0].db).toBe(-100)
  })

  it('entrada sem canal nenhum conta como silêncio e o relógio continua andando', () => {
    // Sem isso, um microfone aberto nunca chegaria aos 600 ms de soltura.
    const { processor, posted } = loadWorklet(48000)

    for (let q = 0; q < 4; q++) processor.process([[]])

    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ db: -100, t: 10 })
  })

  it('amostra NaN vira −100, não NaN', () => {
    const { processor, posted } = loadWorklet(48000)

    feedConstant(processor, Number.NaN, 4)

    expect(posted[0].db).toBe(-100)
  })

  it('process() devolve true sempre — false mataria o nó — e entrada torta não lança', () => {
    const { processor } = loadWorklet(48000)

    expect(processor.process(undefined)).toBe(true)
    expect(processor.process(null)).toBe(true)
    expect(processor.process([])).toBe(true)
    expect(processor.process([[new Float32Array(128)]])).toBe(true)
  })
})
