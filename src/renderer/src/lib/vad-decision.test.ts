// Prova da DECISÃO do detector de voz — a parte pura de `lib/vad.ts`.
//
// Roda no ambiente padrão do projeto (edge-runtime): a decisão não toca em Web
// Audio, só recebe `(nívelDb, agoraMs)` bloco a bloco. É aqui que mora o que o
// Leo sentiu na call de teste no Windows ("preciso falar mais alto pra pegar" e
// "corta minha voz"), então cada `it` abaixo é uma frase que dá para ler em voz
// alta para ele.
//
// O que ESTE arquivo NÃO prova: que o AudioWorklet entrega blocos de 10 ms no
// Chromium real, nem os níveis exatos de fala do microfone dele com AGC/NS do
// WebRTC ligados. Os números de nível usados aqui (fala ≈ −35…−20 dBFS, sala
// ≈ −80…−55 dBFS) são as faixas típicas; o teste na call é o que confirma.
import { describe, expect, it } from 'vitest'

import {
  VAD_AUTO_MAX_THRESHOLD_DB,
  VAD_AUTO_MIN_THRESHOLD_DB,
  VAD_HYSTERESIS_DB,
  VAD_RELEASE_MS,
  createVadDecision,
  rmsToDb,
  type VadDecision
} from './vad'

/** Um bloco de medição do worklet: ~10 ms. */
const BLOCK_MS = 10

type Transition = { atMs: number; speaking: boolean }

/**
 * Alimenta `decision` com `levelDb` (constante ou função do tempo) de
 * `fromMs` (incluso) até `toMs` (excluso), um bloco a cada 10 ms. Devolve as
 * TRANSIÇÕES observadas — é o que vira `setMicrophoneEnabled` lá fora.
 */
function feed(
  decision: VadDecision,
  levelDb: number | ((nowMs: number) => number),
  fromMs: number,
  toMs: number
): Transition[] {
  const transitions: Transition[] = []
  let previous = decision.speaking
  for (let t = fromMs; t < toMs; t += BLOCK_MS) {
    const level = typeof levelDb === 'function' ? levelDb(t) : levelDb
    const speaking = decision.push(level, t)
    if (speaking !== previous) transitions.push({ atMs: t, speaking })
    previous = speaking
  }
  return transitions
}

function manual(thresholdDb: number): VadDecision {
  return createVadDecision({ autoSensitivity: false, thresholdDb })
}

function auto(): VadDecision {
  return createVadDecision({ autoSensitivity: true, thresholdDb: -50 })
}

// --------------------------------------------------------------------------
// Ataque, soltura e histerese (modo manual: limiar fixo, fácil de raciocinar)
// --------------------------------------------------------------------------

describe('createVadDecision — ataque', () => {
  it('fala acima do limiar abre o microfone NO PRIMEIRO bloco', () => {
    const decision = manual(-50)

    expect(decision.push(-40, 0)).toBe(true)
    expect(decision.speaking).toBe(true)
  })

  it('exatamente no limiar também abre (>=, não >)', () => {
    expect(manual(-50).push(-50, 0)).toBe(true)
  })

  it('abaixo do limiar não abre', () => {
    const decision = manual(-50)

    expect(feed(decision, -51, 0, 2000)).toEqual([])
    expect(decision.speaking).toBe(false)
  })
})

describe('createVadDecision — soltura de 600 ms', () => {
  it(`a constante de soltura é ${VAD_RELEASE_MS} ms`, () => {
    // Trava a decisão: 300 ms (o valor antigo) cortava fim de palavra.
    expect(VAD_RELEASE_MS).toBe(600)
  })

  it('pausa de 400 ms no meio da frase NÃO fecha o microfone', () => {
    const decision = manual(-50)

    const transitions = [
      ...feed(decision, -30, 0, 1000), // fala
      ...feed(decision, -80, 1000, 1400), // pausa de 400 ms
      ...feed(decision, -30, 1400, 2000) // volta a falar
    ]

    expect(transitions).toEqual([{ atMs: 0, speaking: true }])
  })

  it('pausa de 700 ms fecha — e fecha aos 600 ms de silêncio, não antes', () => {
    const decision = manual(-50)
    feed(decision, -30, 0, 1000)

    const transitions = feed(decision, -80, 1000, 1700)

    // Primeiro bloco abaixo em t=1000; 600 ms contínuos depois => t=1600.
    expect(transitions).toEqual([{ atMs: 1600, speaking: false }])
  })

  it('um único bloco de fala no meio da pausa reinicia a contagem', () => {
    const decision = manual(-50)
    feed(decision, -30, 0, 1000)

    const transitions = [
      ...feed(decision, -80, 1000, 1500),
      ...feed(decision, -30, 1500, 1510), // uma sílaba curta
      ...feed(decision, -80, 1510, 2050)
    ]

    expect(transitions).toEqual([])
    expect(decision.speaking).toBe(true)
  })
})

describe('createVadDecision — histerese de 6 dB', () => {
  it(`a histerese é ${VAD_HYSTERESIS_DB} dB`, () => {
    expect(VAD_HYSTERESIS_DB).toBe(6)
  })

  it('aberto, um nível entre (limiar − 6) e o limiar MANTÉM aberto — fim de palavra não corta', () => {
    const decision = manual(-50)
    feed(decision, -40, 0, 100)

    // −53 dB: abaixo do limiar de abertura (−50), acima do de fechamento (−56).
    const transitions = feed(decision, -53, 100, 3000)

    expect(transitions).toEqual([])
    expect(decision.speaking).toBe(true)
  })

  it('aberto, abaixo de (limiar − 6) por 600 ms fecha', () => {
    const decision = manual(-50)
    feed(decision, -40, 0, 100)

    const transitions = feed(decision, -57, 100, 800)

    expect(transitions).toEqual([{ atMs: 700, speaking: false }])
  })

  it('fechado, o mesmo nível intermediário NÃO reabre — reabrir exige o limiar cheio', () => {
    const decision = manual(-50)

    expect(feed(decision, -53, 0, 2000)).toEqual([])
  })
})

// --------------------------------------------------------------------------
// Modo automático ("Determinar automaticamente a sensibilidade", padrão LIGADO)
// --------------------------------------------------------------------------

describe('createVadDecision — sensibilidade automática', () => {
  it('ruído constante em −55 dB não abre o microfone', () => {
    const decision = auto()

    expect(feed(decision, -55, 0, 20_000)).toEqual([])
  })

  it('com ruído em −55 dB, fala em −30 dB abre no primeiro bloco', () => {
    const decision = auto()
    feed(decision, -55, 0, 5000)

    const transitions = feed(decision, -30, 5000, 5100)

    expect(transitions).toEqual([{ atMs: 5000, speaking: true }])
  })

  it('ruído que sobe devagar (0,5 dB/s, de −60 a −40) não abre sozinho', () => {
    const decision = auto()

    const transitions = feed(decision, (t) => -60 + (t / 1000) * 0.5, 0, 40_000)

    expect(transitions).toEqual([])
  })

  it('sala silenciosa (supressão de ruído ligada): o limiar desce até o piso de −65 dB e fala baixa pega', () => {
    const decision = auto()
    feed(decision, -85, 0, 3000)

    expect(decision.thresholdDb).toBe(VAD_AUTO_MIN_THRESHOLD_DB)
    expect(VAD_AUTO_MIN_THRESHOLD_DB).toBe(-65)
    // Fala baixinha, bem abaixo do −16,5 dBFS do limiar antigo (0,15 RMS).
    expect(decision.push(-45, 3000)).toBe(true)
  })

  it('o limiar automático é o ruído de fundo + 14 dB', () => {
    const decision = auto()
    feed(decision, -72, 0, 3000)

    expect(decision.noiseFloorDb).toBeCloseTo(-72, 5)
    expect(decision.thresholdDb).toBeCloseTo(-58, 5)
  })

  it('o limiar automático nunca passa de −30 dB, nem com ruído alto', () => {
    const decision = auto()
    feed(decision, -40, 0, 60_000)

    expect(VAD_AUTO_MAX_THRESHOLD_DB).toBe(-30)
    expect(decision.thresholdDb).toBe(VAD_AUTO_MAX_THRESHOLD_DB)
  })

  it('ruído alto e constante que abriu o microfone acaba fechando sozinho (não fica preso aberto)', () => {
    // Ventilador/ar-condicionado ligando de repente: −42 dB aparece acima do
    // limiar inicial (−46) e abre. O piso tem que continuar subindo mesmo com
    // o microfone aberto, senão ele fica aberto transmitindo ruído para sempre.
    const decision = auto()
    feed(decision, -80, 0, 2000)

    const transitions = feed(decision, -42, 2000, 60_000)

    expect(transitions[0]).toEqual({ atMs: 2000, speaking: true })
    expect(transitions.at(-1)?.speaking).toBe(false)
    expect(decision.speaking).toBe(false)
  })

  it('a própria voz não prende o piso lá em cima: depois de 5 s falando, o silêncio devolve o limiar na hora', () => {
    const decision = auto()
    feed(decision, -75, 0, 2000)
    const quietThreshold = decision.thresholdDb

    // Pior caso: 5 s de fala SEM nenhuma queda (fala real tem várias).
    const duringSpeech = feed(decision, -30, 2000, 7000)
    expect(duringSpeech).toEqual([{ atMs: 2000, speaking: true }])

    decision.push(-75, 7000)
    expect(decision.thresholdDb).toBeCloseTo(quietThreshold, 5)
  })

  it('silêncio DIGITAL (zeros do início da captura) não derruba o piso — senão o ruído real abriria o microfone', () => {
    // Os primeiros buffers de um MediaStreamSource costumam vir zerados.
    // Se isso puxasse o piso para −100, o limiar iria a −65 e um ruído de
    // −55 abriria o microfone por ~30 s até o piso subir de volta.
    const decision = auto()
    feed(decision, -Infinity, 0, 1000)

    expect(feed(decision, -55, 1000, 20_000)).toEqual([])
  })

  it('começa num piso razoável: não fica mudo no primeiro segundo', () => {
    const decision = auto()

    expect(decision.thresholdDb).toBeLessThanOrEqual(-40)
    expect(decision.push(-35, 0)).toBe(true)
  })
})

// --------------------------------------------------------------------------
// Ajustes ao vivo e entradas hostis
// --------------------------------------------------------------------------

describe('createVadDecision — ajustes ao vivo', () => {
  it('setThresholdDb muda o limiar manual na hora, sem recriar nada', () => {
    const decision = manual(-30)
    expect(decision.push(-40, 0)).toBe(false)

    decision.setThresholdDb(-50)

    expect(decision.thresholdDb).toBe(-50)
    expect(decision.push(-40, 10)).toBe(true)
  })

  it('desligar o automático passa a usar o valor do slider', () => {
    const decision = auto()
    feed(decision, -80, 0, 2000)
    expect(decision.thresholdDb).toBe(-65)

    decision.setAutoSensitivity(false)

    expect(decision.thresholdDb).toBe(-50)
  })

  it('o piso é estimado mesmo no manual: ligar o automático já chega calibrado', () => {
    const decision = manual(-50)
    feed(decision, -72, 0, 3000)

    decision.setAutoSensitivity(true)

    expect(decision.thresholdDb).toBeCloseTo(-58, 5)
  })

  it('limiar manual em −100 dB = microfone sempre aberto (o "zero" que o Leo usava)', () => {
    const decision = manual(-100)

    expect(decision.push(-Infinity, 0)).toBe(true)
  })

  it('limiar manual fora da faixa é preso em −100…0', () => {
    expect(manual(-500).thresholdDb).toBe(-100)
    expect(manual(12).thresholdDb).toBe(0)
    expect(manual(Number.NaN).thresholdDb).toBe(-50)
  })
})

describe('createVadDecision — entradas hostis', () => {
  it('−Infinity e NaN não quebram e contam como silêncio', () => {
    const decision = manual(-50)

    expect(() => feed(decision, -Infinity, 0, 100)).not.toThrow()
    expect(() => feed(decision, Number.NaN, 100, 200)).not.toThrow()
    expect(decision.speaking).toBe(false)
    expect(Number.isFinite(decision.thresholdDb)).toBe(true)
  })

  it('aberto, NaN conta como abaixo e fecha depois da soltura', () => {
    const decision = manual(-50)
    feed(decision, -30, 0, 100)

    const transitions = feed(decision, Number.NaN, 100, 800)

    expect(transitions).toEqual([{ atMs: 700, speaking: false }])
  })

  it('NaN no relógio não quebra nem trava a decisão', () => {
    const decision = auto()

    expect(() => decision.push(-30, Number.NaN)).not.toThrow()
    expect(decision.speaking).toBe(true)
    expect(Number.isFinite(decision.noiseFloorDb)).toBe(true)
  })

  it('relógio que anda para trás não fecha nem estoura o piso', () => {
    const decision = auto()
    feed(decision, -30, 1000, 1100)

    decision.push(-80, 500)

    expect(decision.speaking).toBe(true)
    expect(Number.isFinite(decision.noiseFloorDb)).toBe(true)
  })
})

describe('rmsToDb', () => {
  it('converte RMS linear para dBFS', () => {
    expect(rmsToDb(1)).toBeCloseTo(0, 10)
    expect(rmsToDb(0.1)).toBeCloseTo(-20, 10)
    expect(rmsToDb(0.15)).toBeCloseTo(-16.48, 2)
  })

  it('zero, negativo, NaN e níveis abaixo do piso viram −100', () => {
    expect(rmsToDb(0)).toBe(-100)
    expect(rmsToDb(-1)).toBe(-100)
    expect(rmsToDb(Number.NaN)).toBe(-100)
    expect(rmsToDb(1e-9)).toBe(-100)
  })
})
