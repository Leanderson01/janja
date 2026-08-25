// @vitest-environment jsdom
//
// Prova do defeito de AudioContext suspenso no VAD (quick/002).
//
// O QUE ESTE ARQUIVO PROVA
// -----------------------
// A lógica de retomada: quando `resume()` é chamado, quando NÃO é, o que
// acontece quando ele falha de cada uma das quatro maneiras possíveis, e que
// nada fica pendurado no `document` depois de `stop()`. Tudo isso sobre um
// duplo injetado — é lógica pura de decisão e dá para provar por inteiro.
//
// O QUE ELE NÃO PROVA (e ninguém consegue provar aqui)
// ---------------------------------------------------
// Que um `AudioContext` REAL suspenso congela o `AnalyserNode` e devolve
// zeros. Isso é comportamento do Chromium: nem jsdom nem edge-runtime têm
// Web Audio (não existe `AudioContext`, `AnalyserNode` nem `MediaStream`
// neste ambiente), e esta máquina não tem placa de som nem janela. O elo
// "suspenso => RMS 0 => microfone nunca abre" está documentado na spec e no
// blog do Chrome (URLs em `vad.ts`) e só se confirma no app rodando —
// exatamente o que o teste manual descrito no SUMMARY cobre.
//
// Por isso o duplo abaixo é HOSTIL de propósito: `resolve-stuck` reproduz o
// caso mais traiçoeiro do mundo real — `resume()` RESOLVE mas o estado
// continua suspenso, porque a política de autoplay simplesmente recusou.
// Quem confiar na promise em vez de reler `state` passa por esse caso sem ver.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { createVadMonitor, keepAudioContextRunning } from './vad'

// --------------------------------------------------------------------------
// Duplos
// --------------------------------------------------------------------------

type ResumeBehavior =
  /** Caminho feliz: retoma e passa a `running`. */
  | 'resolve-running'
  /** Autoplay recusou: a promise RESOLVE, o estado NÃO muda. */
  | 'resolve-stuck'
  /** `resume()` rejeita (NotAllowedError). */
  | 'reject'
  /** `resume()` fica pendente para sempre — acontece de verdade em iOS. */
  | 'never'
  /** `resume()` lança de forma síncrona (contexto fechado por baixo). */
  | 'throw'

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  static initialState = 'running'
  static resumeBehavior: ResumeBehavior = 'resolve-running'

  state: string
  resumes = 0
  closes = 0
  private listeners = new Map<string, Set<() => void>>()

  constructor() {
    this.state = FakeAudioContext.initialState
    FakeAudioContext.instances.push(this)
  }

  // --- EventTarget o suficiente para `statechange` ---
  addEventListener(type: string, fn: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }

  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn)
  }

  /** Quantos listeners de `statechange` continuam registrados — é assim que se
   * prova que `stop()` não vaza. */
  stateChangeListenerCount(): number {
    return this.listeners.get('statechange')?.size ?? 0
  }

  /** Muda o estado COMO O NAVEGADOR MUDA: emitindo `statechange`. */
  setState(next: string): void {
    this.state = next
    // Cópia: um handler pode se desregistrar durante a emissão.
    ;[...(this.listeners.get('statechange') ?? [])].forEach((fn) => fn())
  }

  resume(): Promise<void> {
    this.resumes++
    switch (FakeAudioContext.resumeBehavior) {
      case 'resolve-running':
        this.setState('running')
        return Promise.resolve()
      case 'resolve-stuck':
        return Promise.resolve()
      case 'reject':
        return Promise.reject(new Error('NotAllowedError'))
      case 'never':
        return new Promise<void>(() => {})
      case 'throw':
        throw new Error('InvalidStateError')
    }
  }

  close(): Promise<void> {
    this.closes++
    this.state = 'closed'
    return Promise.resolve()
  }

  // --- Grafo mínimo para `createVadMonitor` ---
  createMediaStreamSource(): { connect: () => void; disconnect: () => void } {
    return { connect: () => {}, disconnect: () => {} }
  }

  createAnalyser(): FakeAnalyser {
    return new FakeAnalyser()
  }
}

class FakeAnalyser {
  fftSize = 2048
  /** Amplitude constante que `getFloatTimeDomainData` escreve no buffer. */
  static sample = 0
  disconnects = 0

  getFloatTimeDomainData(buffer: Float32Array): void {
    buffer.fill(FakeAnalyser.sample)
  }

  disconnect(): void {
    this.disconnects++
  }
}

/** Os mesmos tipos que `vad.ts` arma; qualquer um a mais/a menos aparece aqui. */
const GESTURE_TYPES = ['pointerdown', 'mousedown', 'keydown', 'touchend']

/** Listeners de gesto VIVOS no `document`, contados observando
 * `addEventListener`/`removeEventListener` de verdade. Contar efeito ("o
 * clique não retomou") não basta: as guardas de `disposed` e de estado fazem
 * um listener vazado parecer inofensivo, e ele continua lá para sempre. */
let liveGestureListeners: Array<{ type: string; fn: unknown }> = []

function gestureListenerCount(): number {
  return liveGestureListeners.length
}

/** Frames de `requestAnimationFrame` sob controle do teste — sem isto o
 * monitor gira sozinho e nada é determinístico. */
let pendingFrames: FrameRequestCallback[] = []

function runOneFrame(): void {
  const frames = pendingFrames
  pendingFrames = []
  frames.forEach((fn) => fn(0))
}

function fakeContext(): FakeAudioContext {
  return new FakeAudioContext()
}

/** O duplo tem só o pedaço de `AudioContext` que este módulo toca. */
function asAudioContext(ctx: FakeAudioContext): AudioContext {
  return ctx as unknown as AudioContext
}

/** Chamadas de console capturadas por nível. Guardar os argumentos em vez do
 * `MockInstance` mantém o arquivo livre dos genéricos de spy do vitest, que
 * não sobrevivem ao `tsc` deste projeto. */
let logged: { warn: unknown[][]; error: unknown[][]; info: unknown[][] }

/** Todos os argumentos de todas as chamadas, achatados em texto — deixa a
 * asserção de log indiferente a `%s` vs interpolação. */
function loggedText(calls: unknown[][]): string {
  return calls.map((call) => call.map((arg) => String(arg)).join(' ')).join('\n')
}

beforeEach(() => {
  FakeAudioContext.instances = []
  FakeAudioContext.initialState = 'running'
  FakeAudioContext.resumeBehavior = 'resolve-running'
  FakeAnalyser.sample = 0
  pendingFrames = []

  const g = globalThis as unknown as Record<string, unknown>
  g.MediaStream = class {
    constructor(public tracks: unknown[]) {}
  }
  ;(window as unknown as Record<string, unknown>).AudioContext = FakeAudioContext
  g.requestAnimationFrame = (fn: FrameRequestCallback): number => {
    pendingFrames.push(fn)
    return pendingFrames.length
  }
  g.cancelAnimationFrame = (): void => {}

  liveGestureListeners = []
  const realAdd = document.addEventListener.bind(document)
  const realRemove = document.removeEventListener.bind(document)
  vi.spyOn(document, 'addEventListener').mockImplementation(((
    type: string,
    fn: EventListenerOrEventListenerObject,
    opts?: boolean | AddEventListenerOptions
  ): void => {
    if (GESTURE_TYPES.includes(type)) liveGestureListeners.push({ type, fn })
    realAdd(type, fn, opts)
  }) as typeof document.addEventListener)
  vi.spyOn(document, 'removeEventListener').mockImplementation(((
    type: string,
    fn: EventListenerOrEventListenerObject,
    opts?: boolean | EventListenerOptions
  ): void => {
    if (GESTURE_TYPES.includes(type)) {
      liveGestureListeners = liveGestureListeners.filter((l) => !(l.type === type && l.fn === fn))
    }
    realRemove(type, fn, opts)
  }) as typeof document.removeEventListener)

  logged = { warn: [], error: [], info: [] }
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    logged.warn.push(args)
  })
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.error.push(args)
  })
  vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
    logged.info.push(args)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// --------------------------------------------------------------------------
// Quando retomar, e quando NÃO retomar
// --------------------------------------------------------------------------

describe('keepAudioContextRunning — decisão de retomar', () => {
  it('1. contexto nascido `suspended` é retomado — o defeito de quick/002 em uma linha', () => {
    FakeAudioContext.initialState = 'suspended'
    const ctx = fakeContext()

    keepAudioContextRunning(asAudioContext(ctx))

    expect(ctx.resumes).toBe(1)
    expect(ctx.state).toBe('running')
  })

  it('2. contexto nascido `interrupted` TAMBÉM é retomado — `=== "suspended"` não basta', () => {
    // O quarto estado do MDN: outro app tomou o hardware, ou o laptop fechou.
    // Congela o grafo igual a `suspended` e passa batido por igualdade.
    FakeAudioContext.initialState = 'interrupted'
    const ctx = fakeContext()

    keepAudioContextRunning(asAudioContext(ctx))

    expect(ctx.resumes).toBe(1)
  })

  it('3. contexto nascido `running` NÃO é tocado — nada de resume() gratuito', () => {
    FakeAudioContext.initialState = 'running'
    const ctx = fakeContext()

    keepAudioContextRunning(asAudioContext(ctx))

    expect(ctx.resumes).toBe(0)
    expect(logged.warn).toEqual([])
    expect(logged.error).toEqual([])
  })

  it('4. contexto `closed` NÃO é retomado — dali não se volta, resume() só rejeitaria', () => {
    FakeAudioContext.initialState = 'closed'
    const ctx = fakeContext()

    keepAudioContextRunning(asAudioContext(ctx))

    expect(ctx.resumes).toBe(0)
  })

  it('5. suspensão POSTERIOR (SO dormindo, hardware tomado) também é retomada', () => {
    const ctx = fakeContext() // nasce running
    keepAudioContextRunning(asAudioContext(ctx))
    expect(ctx.resumes).toBe(0)

    ctx.setState('suspended')

    expect(ctx.resumes).toBe(1)
    expect(ctx.state).toBe('running')
  })

  it('6. interrupção POSTERIOR também é retomada', () => {
    const ctx = fakeContext()
    keepAudioContextRunning(asAudioContext(ctx))

    ctx.setState('interrupted')

    expect(ctx.resumes).toBe(1)
  })
})

// --------------------------------------------------------------------------
// O defeito deixa de ser silencioso
// --------------------------------------------------------------------------

describe('keepAudioContextRunning — visibilidade', () => {
  it('7. retomada bem-sucedida sai como info `[voice]`, e NÃO como erro', async () => {
    FakeAudioContext.initialState = 'suspended'
    keepAudioContextRunning(asAudioContext(fakeContext()))
    await Promise.resolve()

    expect(loggedText(logged.info)).toContain('[voice]')
    expect(loggedText(logged.info)).toMatch(/retomado/i)
    expect(logged.error).toEqual([])
  })

  it('8. `resume()` que RESOLVE mas não retoma vira console.error — o caso mais traiçoeiro', async () => {
    // A política de autoplay recusou. A promise resolve; o estado continua
    // suspenso. Quem confia na promise em vez de reler `state` não vê nada.
    FakeAudioContext.initialState = 'suspended'
    FakeAudioContext.resumeBehavior = 'resolve-stuck'
    const ctx = fakeContext()

    keepAudioContextRunning(asAudioContext(ctx))
    await Promise.resolve()
    await Promise.resolve()

    expect(ctx.state).toBe('suspended')
    const text = loggedText(logged.error)
    expect(text).toContain('[voice]')
    expect(text).toMatch(/INOPERANTE/)
  })

  it('9. `resume()` que rejeita vira console.error com a causa', async () => {
    FakeAudioContext.initialState = 'suspended'
    FakeAudioContext.resumeBehavior = 'reject'

    keepAudioContextRunning(asAudioContext(fakeContext()))
    await Promise.resolve()
    await Promise.resolve()

    expect(loggedText(logged.error)).toContain('NotAllowedError')
  })

  it('10. `resume()` que nunca assenta ainda assim emite o diagnóstico (timer de veredito)', async () => {
    vi.useFakeTimers()
    FakeAudioContext.initialState = 'suspended'
    FakeAudioContext.resumeBehavior = 'never'

    keepAudioContextRunning(asAudioContext(fakeContext()))
    expect(logged.error).toEqual([]) // ainda dentro da janela

    await vi.advanceTimersByTimeAsync(600)

    expect(loggedText(logged.error)).toMatch(/INOPERANTE/)
  })

  it('11. `resume()` que lança de forma síncrona não escapa para quem chamou', () => {
    FakeAudioContext.initialState = 'suspended'
    FakeAudioContext.resumeBehavior = 'throw'

    expect(() => keepAudioContextRunning(asAudioContext(fakeContext()))).not.toThrow()
    expect(loggedText(logged.error)).toContain('InvalidStateError')
  })
})

// --------------------------------------------------------------------------
// Rearme no gesto do usuário — o que tira o "funciona por sorte" da equação
// --------------------------------------------------------------------------

describe('keepAudioContextRunning — rearme no gesto do usuário', () => {
  it('12. depois de falhar, um clique em QUALQUER lugar tenta de novo', async () => {
    FakeAudioContext.initialState = 'suspended'
    FakeAudioContext.resumeBehavior = 'resolve-stuck'
    const ctx = fakeContext()

    keepAudioContextRunning(asAudioContext(ctx))
    await Promise.resolve()
    await Promise.resolve()
    expect(ctx.resumes).toBe(1)
    expect(gestureListenerCount()).toBe(GESTURE_TYPES.length)

    // Agora o usuário clica em algo — a página ganha sticky activation.
    FakeAudioContext.resumeBehavior = 'resolve-running'
    document.dispatchEvent(new MouseEvent('mousedown'))

    expect(ctx.resumes).toBe(2)
    expect(ctx.state).toBe('running')
  })

  it('13. uma tecla serve tanto quanto um clique', async () => {
    FakeAudioContext.initialState = 'suspended'
    FakeAudioContext.resumeBehavior = 'resolve-stuck'
    const ctx = fakeContext()

    keepAudioContextRunning(asAudioContext(ctx))
    await Promise.resolve()
    await Promise.resolve()

    FakeAudioContext.resumeBehavior = 'resolve-running'
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))

    expect(ctx.state).toBe('running')
  })

  it('14. o rearme não fica pendurado: retomado, gestos seguintes não chamam resume()', async () => {
    FakeAudioContext.initialState = 'suspended'
    FakeAudioContext.resumeBehavior = 'resolve-stuck'
    const ctx = fakeContext()

    keepAudioContextRunning(asAudioContext(ctx))
    await Promise.resolve()
    await Promise.resolve()

    FakeAudioContext.resumeBehavior = 'resolve-running'
    document.dispatchEvent(new MouseEvent('mousedown'))
    const afterFirstGesture = ctx.resumes

    // O listener some do `document` no ato — não fica dormente contando com a
    // guarda de estado para não fazer nada.
    expect(gestureListenerCount()).toBe(0)

    document.dispatchEvent(new MouseEvent('mousedown'))
    document.dispatchEvent(new MouseEvent('mousedown'))

    expect(ctx.resumes).toBe(afterFirstGesture)
  })

  it('15. o descarte solta o listener de gesto — clique depois disso não retoma nada', async () => {
    FakeAudioContext.initialState = 'suspended'
    FakeAudioContext.resumeBehavior = 'resolve-stuck'
    const ctx = fakeContext()

    const dispose = keepAudioContextRunning(asAudioContext(ctx))
    await Promise.resolve()
    await Promise.resolve()
    const before = ctx.resumes
    expect(gestureListenerCount()).toBe(GESTURE_TYPES.length)

    dispose()

    // Some do `document` de verdade — um monitor parado não pode deixar
    // listener para trás a cada abrir/fechar do painel de configurações.
    expect(gestureListenerCount()).toBe(0)
    FakeAudioContext.resumeBehavior = 'resolve-running'
    document.dispatchEvent(new MouseEvent('mousedown'))

    expect(ctx.resumes).toBe(before)
  })

  it('16. o descarte solta o listener de `statechange`', () => {
    const ctx = fakeContext()
    const dispose = keepAudioContextRunning(asAudioContext(ctx))
    expect(ctx.stateChangeListenerCount()).toBe(1)

    dispose()

    expect(ctx.stateChangeListenerCount()).toBe(0)
    ctx.setState('suspended')
    expect(ctx.resumes).toBe(0)
  })

  it('17. contexto fechado se descarta sozinho — nada sobrevive ao `close()`', () => {
    const ctx = fakeContext()
    keepAudioContextRunning(asAudioContext(ctx))

    ctx.setState('closed')

    expect(ctx.stateChangeListenerCount()).toBe(0)
  })
})

// --------------------------------------------------------------------------
// A ligação com o monitor de verdade
// --------------------------------------------------------------------------

describe('createVadMonitor', () => {
  const track = { kind: 'audio' } as unknown as MediaStreamTrack

  it('18. o monitor retoma o contexto que nasceu suspenso — a correção está LIGADA', () => {
    // Sem esta asserção, `keepAudioContextRunning` poderia estar perfeito e
    // nunca ser chamado, que é precisamente o estado anterior do arquivo.
    FakeAudioContext.initialState = 'suspended'

    const monitor = createVadMonitor(track, { threshold: 0.05, onSpeakingChange: () => {} })

    expect(FakeAudioContext.instances[0].resumes).toBe(1)
    monitor.stop()
  })

  it('19. `stop()` descarta o keeper: nem `statechange` nem gesto sobrevivem', async () => {
    FakeAudioContext.initialState = 'suspended'
    FakeAudioContext.resumeBehavior = 'resolve-stuck'

    const monitor = createVadMonitor(track, { threshold: 0.05, onSpeakingChange: () => {} })
    await Promise.resolve()
    await Promise.resolve()
    const ctx = FakeAudioContext.instances[0]
    const before = ctx.resumes

    expect(gestureListenerCount()).toBe(GESTURE_TYPES.length)

    monitor.stop()

    expect(gestureListenerCount()).toBe(0)
    FakeAudioContext.resumeBehavior = 'resolve-running'
    document.dispatchEvent(new MouseEvent('mousedown'))
    expect(ctx.resumes).toBe(before)
    expect(ctx.stateChangeListenerCount()).toBe(0)
    expect(ctx.closes).toBe(1)
  })

  it('20. contexto retomado e nível acima do limiar => o microfone abre', () => {
    // O elo inteiro, do lado que dá para provar: contexto andando, analisador
    // devolvendo amostra real, limiar cruzado, callback disparado. Com o
    // contexto congelado o buffer seria de zeros e isto nunca aconteceria.
    FakeAudioContext.initialState = 'suspended'
    FakeAnalyser.sample = 0.4
    const onSpeakingChange = vi.fn()

    const monitor = createVadMonitor(track, { threshold: 0.05, onSpeakingChange })
    expect(FakeAudioContext.instances[0].state).toBe('running')

    runOneFrame()

    expect(onSpeakingChange).toHaveBeenCalledWith(true)
    monitor.stop()
  })

  it('21. silêncio digital (o que um contexto congelado entrega) nunca abre o microfone', () => {
    FakeAnalyser.sample = 0
    const onSpeakingChange = vi.fn()

    const monitor = createVadMonitor(track, { threshold: 0.05, onSpeakingChange })
    runOneFrame()
    runOneFrame()

    expect(onSpeakingChange).not.toHaveBeenCalled()
    monitor.stop()
  })
})
