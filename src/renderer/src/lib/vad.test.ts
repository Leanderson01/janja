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

import workletSource from './vad-level-processor.js?raw'
import {
  VAD_LEVEL_PROCESSOR_NAME,
  createVadMonitor,
  keepAudioContextRunning,
  type VadLevelReading
} from './vad'

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

/** Como o `audioWorklet.addModule` do duplo se comporta. */
type WorkletBehavior =
  /** Sem `audioWorklet` (contexto não seguro, navegador velho). */
  | 'absent'
  /** Carrega. */
  | 'resolve'
  /** CSP bloqueou / 404. */
  | 'reject'
  /** Fica pendente até o teste mandar (`finishAddModule`). */
  | 'manual'

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  static initialState = 'running'
  static resumeBehavior: ResumeBehavior = 'resolve-running'
  static workletBehavior: WorkletBehavior = 'absent'
  /** `createAnalyser` lança: o fallback também não sobe. */
  static analyserThrows = false

  state: string
  resumes = 0
  closes = 0
  addModuleCalls: string[] = []
  analysers: FakeAnalyser[] = []
  gains: FakeGain[] = []
  readonly destination = { role: 'destination' }
  audioWorklet?: { addModule: (url: string) => Promise<void> }
  private releaseAddModule: (() => void) | null = null
  private listeners = new Map<string, Set<() => void>>()

  constructor() {
    this.state = FakeAudioContext.initialState
    FakeAudioContext.instances.push(this)
    const behavior = FakeAudioContext.workletBehavior
    if (behavior !== 'absent') {
      this.audioWorklet = {
        addModule: (url: string): Promise<void> => {
          this.addModuleCalls.push(url)
          if (behavior === 'reject') return Promise.reject(new Error('CSP bloqueou o worklet'))
          if (behavior === 'manual') {
            return new Promise<void>((resolve) => {
              this.releaseAddModule = resolve
            })
          }
          return Promise.resolve()
        }
      }
    }
  }

  /** Para o modo 'manual': o `addModule` pendente resolve agora. */
  finishAddModule(): void {
    this.releaseAddModule?.()
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
  source = {
    connectedTo: [] as unknown[],
    disconnects: 0,
    connect: (node: unknown): void => {
      this.source.connectedTo.push(node)
    },
    disconnect: (): void => {
      this.source.disconnects++
    }
  }

  createMediaStreamSource(): FakeAudioContext['source'] {
    return this.source
  }

  createAnalyser(): FakeAnalyser {
    if (FakeAudioContext.analyserThrows) throw new Error('createAnalyser explodiu')
    const analyser = new FakeAnalyser()
    this.analysers.push(analyser)
    return analyser
  }

  createGain(): FakeGain {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain
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

class FakeGain {
  gain = { value: 1 }
  connectedTo: unknown[] = []
  disconnects = 0

  connect(node: unknown): void {
    this.connectedTo.push(node)
  }

  disconnect(): void {
    this.disconnects++
  }
}

class FakeAudioWorkletNode {
  static instances: FakeAudioWorkletNode[] = []

  port: { onmessage: ((event: { data: unknown }) => void) | null } = { onmessage: null }
  connectedTo: unknown[] = []
  disconnects = 0

  constructor(
    public context: FakeAudioContext,
    public name: string,
    public options: AudioWorkletNodeOptions
  ) {
    FakeAudioWorkletNode.instances.push(this)
  }

  connect(node: unknown): void {
    this.connectedTo.push(node)
  }

  disconnect(): void {
    this.disconnects++
  }

  /** O que o worklet real posta a cada bloco de ~10 ms. */
  postLevel(db: number, t: number): void {
    this.port.onmessage?.({ data: { type: 'level', db, t } })
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

/** Deixa as promises encadeadas (`addModule` -> criação do nó, ou a rejeição
 * -> fallback) assentarem. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
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
  FakeAudioContext.workletBehavior = 'absent'
  FakeAudioContext.analyserThrows = false
  FakeAnalyser.sample = 0
  FakeAudioWorkletNode.instances = []

  const g = globalThis as unknown as Record<string, unknown>
  g.MediaStream = class {
    constructor(public tracks: unknown[]) {}
  }
  ;(window as unknown as Record<string, unknown>).AudioContext = FakeAudioContext
  g.AudioWorkletNode = FakeAudioWorkletNode

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

  /** Manual em −50 dB: o mais fácil de raciocinar nos testes de fiação. */
  const MANUAL = { autoSensitivity: false, thresholdDb: -50 } as const

  it('18. o monitor retoma o contexto que nasceu suspenso — a correção está LIGADA', () => {
    // Sem esta asserção, `keepAudioContextRunning` poderia estar perfeito e
    // nunca ser chamado, que é precisamente o estado anterior do arquivo.
    FakeAudioContext.initialState = 'suspended'

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange: () => {} })

    expect(FakeAudioContext.instances[0].resumes).toBe(1)
    monitor.stop()
  })

  it('19. `stop()` descarta o keeper: nem `statechange` nem gesto sobrevivem', async () => {
    FakeAudioContext.initialState = 'suspended'
    FakeAudioContext.resumeBehavior = 'resolve-stuck'

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange: () => {} })
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

  it('20. fallback: contexto retomado e nível acima do limiar => o microfone abre', async () => {
    // O elo inteiro, do lado que dá para provar: contexto andando, analisador
    // devolvendo amostra real, limiar cruzado, callback disparado. Com o
    // contexto congelado o buffer seria de zeros e isto nunca aconteceria.
    vi.useFakeTimers()
    FakeAudioContext.initialState = 'suspended'
    FakeAnalyser.sample = 0.4 // ≈ −8 dBFS
    const onSpeakingChange = vi.fn()

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange })
    expect(FakeAudioContext.instances[0].state).toBe('running')
    await settle()

    vi.advanceTimersByTime(20)

    expect(onSpeakingChange).toHaveBeenCalledWith(true)
    monitor.stop()
  })

  it('21. silêncio digital (o que um contexto congelado entrega) nunca abre o microfone', async () => {
    vi.useFakeTimers()
    FakeAnalyser.sample = 0
    const onSpeakingChange = vi.fn()

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange })
    await settle()
    vi.advanceTimersByTime(200)

    expect(onSpeakingChange).not.toHaveBeenCalled()
    monitor.stop()
  })

  it('22. o nome do processador não diverge do registerProcessor do worklet', () => {
    expect(workletSource).toContain(`registerProcessor('${VAD_LEVEL_PROCESSOR_NAME}'`)
  })

  it('23. worklet: carregado pela URL do ASSET (nunca data:/blob:), mono, puxado por um ganho ZERO', async () => {
    FakeAudioContext.workletBehavior = 'resolve'

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange: () => {} })
    await settle()
    const ctx = FakeAudioContext.instances[0]

    expect(ctx.addModuleCalls).toHaveLength(1)
    const url = ctx.addModuleCalls[0]
    expect(url).toContain('vad-level-processor')
    // CSP `script-src 'self'`: `data:`/`blob:` seriam bloqueados e o VAD
    // cairia sempre no fallback sem erro de aplicação.
    expect(url.startsWith('data:')).toBe(false)
    expect(url.startsWith('blob:')).toBe(false)

    const node = FakeAudioWorkletNode.instances[0]
    expect(node.name).toBe(VAD_LEVEL_PROCESSOR_NAME)
    expect(node.options).toMatchObject({ channelCount: 1, channelCountMode: 'explicit' })
    expect(ctx.source.connectedTo).toContain(node)

    // Puxado pelo grafo SEM tocar nada: nó -> ganho 0 -> destination.
    const sink = ctx.gains[0]
    expect(node.connectedTo).toEqual([sink])
    expect(sink.gain.value).toBe(0)
    expect(sink.connectedTo).toEqual([ctx.destination])

    // Nada de AnalyserNode nem timer de fallback no caminho principal.
    expect(ctx.analysers).toHaveLength(0)
    monitor.stop()
  })

  it('24. worklet: abre no primeiro bloco acima do limiar e fecha depois de 600 ms abaixo', async () => {
    FakeAudioContext.workletBehavior = 'resolve'
    const onSpeakingChange = vi.fn()

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange })
    await settle()
    const node = FakeAudioWorkletNode.instances[0]

    node.postLevel(-30, 10)
    expect(onSpeakingChange).toHaveBeenCalledTimes(1)
    expect(onSpeakingChange).toHaveBeenLastCalledWith(true)

    // Pausa de 400 ms: nada muda.
    for (let t = 20; t <= 410; t += 10) node.postLevel(-80, t)
    node.postLevel(-30, 420)
    expect(onSpeakingChange).toHaveBeenCalledTimes(1)

    // Silêncio de verdade: fecha aos 600 ms contínuos, pelo relógio do ÁUDIO
    // (o `t` dos blocos), não pelo relógio da thread principal.
    for (let t = 430; t <= 1030; t += 10) node.postLevel(-80, t)
    expect(onSpeakingChange).toHaveBeenCalledTimes(2)
    expect(onSpeakingChange).toHaveBeenLastCalledWith(false)
    monitor.stop()
  })

  it('25. worklet: mensagem torta é ignorada, não lança nem decide', async () => {
    FakeAudioContext.workletBehavior = 'resolve'
    const onSpeakingChange = vi.fn()

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange })
    await settle()
    const node = FakeAudioWorkletNode.instances[0]

    expect(() => {
      node.port.onmessage?.({ data: null })
      node.port.onmessage?.({ data: { type: 'stats' } })
      node.port.onmessage?.({ data: { type: 'level', db: '-10', t: 10 } })
    }).not.toThrow()
    expect(onSpeakingChange).not.toHaveBeenCalled()
    monitor.stop()
  })

  it('26. medidor: no máximo ~30 leituras/s, com o PICO do intervalo e o limiar em vigor', async () => {
    FakeAudioContext.workletBehavior = 'resolve'
    const readings: VadLevelReading[] = []

    const monitor = createVadMonitor(track, {
      ...MANUAL,
      onSpeakingChange: () => {},
      onLevel: (reading) => readings.push(reading)
    })
    await settle()
    const node = FakeAudioWorkletNode.instances[0]

    // 1 s de blocos (100), com um pico curto de −20 dB no meio do 2º intervalo.
    for (let t = 10; t <= 1000; t += 10) node.postLevel(t === 50 ? -20 : -70, t)

    expect(readings.length).toBeGreaterThanOrEqual(25)
    expect(readings.length).toBeLessThanOrEqual(35)
    expect(readings.some((r) => r.levelDb === -20)).toBe(true)
    expect(readings.every((r) => r.thresholdDb === -50)).toBe(true)
    monitor.stop()
  })

  it('27. setThreshold e setAutoSensitivity valem AO VIVO, sem recriar o monitor', async () => {
    FakeAudioContext.workletBehavior = 'resolve'
    const onSpeakingChange = vi.fn()
    const readings: VadLevelReading[] = []

    const monitor = createVadMonitor(track, {
      autoSensitivity: false,
      thresholdDb: -20,
      onSpeakingChange,
      onLevel: (reading) => readings.push(reading)
    })
    await settle()
    const node = FakeAudioWorkletNode.instances[0]

    node.postLevel(-30, 10)
    expect(onSpeakingChange).not.toHaveBeenCalled()

    monitor.setThreshold(-40)
    node.postLevel(-30, 20)
    expect(onSpeakingChange).toHaveBeenCalledWith(true)

    // Automático com sala em −80 dB: o limiar calculado vai ao piso de −65.
    monitor.setAutoSensitivity(true)
    for (let t = 30; t <= 2000; t += 10) node.postLevel(-80, t)
    expect(readings.at(-1)?.thresholdDb).toBe(-65)
    expect(FakeAudioContext.instances).toHaveLength(1)
    monitor.stop()
  })

  it('28. worklet bloqueado (addModule rejeita) => fallback AnalyserNode de 512 a cada 20 ms, com aviso', async () => {
    vi.useFakeTimers()
    FakeAudioContext.workletBehavior = 'reject'
    FakeAnalyser.sample = 0.4
    const onSpeakingChange = vi.fn()

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange })
    await settle()
    const ctx = FakeAudioContext.instances[0]

    expect(FakeAudioWorkletNode.instances).toHaveLength(0)
    expect(ctx.analysers).toHaveLength(1)
    expect(ctx.analysers[0].fftSize).toBe(512)
    expect(loggedText(logged.warn)).toMatch(/fallback/i)
    expect(loggedText(logged.warn)).toContain('CSP bloqueou o worklet')

    vi.advanceTimersByTime(19)
    expect(onSpeakingChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onSpeakingChange).toHaveBeenCalledWith(true)
    monitor.stop()
  })

  it('29. sem `audioWorklet` no contexto => fallback também, sem lançar para quem criou', async () => {
    vi.useFakeTimers()
    FakeAudioContext.workletBehavior = 'absent'

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange: () => {} })
    await settle()

    expect(FakeAudioContext.instances[0].analysers).toHaveLength(1)
    expect(loggedText(logged.info)).toMatch(/AnalyserNode/)
    monitor.stop()
  })

  it('30. worklet carregado mas MUDO com o contexto rodando => troca para o fallback', async () => {
    vi.useFakeTimers()
    FakeAudioContext.workletBehavior = 'resolve'

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange: () => {} })
    await settle()
    const ctx = FakeAudioContext.instances[0]
    const node = FakeAudioWorkletNode.instances[0]

    vi.advanceTimersByTime(1000)
    expect(ctx.analysers).toHaveLength(0) // uma conferência só não basta

    vi.advanceTimersByTime(1000)
    expect(ctx.analysers).toHaveLength(1)
    expect(node.port.onmessage).toBeNull()
    expect(node.disconnects).toBeGreaterThan(0)
    monitor.stop()
  })

  it('31. o vigia não culpa o worklet por um contexto SUSPENSO — isso é do keeper', async () => {
    vi.useFakeTimers()
    FakeAudioContext.workletBehavior = 'resolve'
    FakeAudioContext.initialState = 'suspended'
    FakeAudioContext.resumeBehavior = 'resolve-stuck'

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange: () => {} })
    await settle()

    vi.advanceTimersByTime(5000)

    expect(FakeAudioContext.instances[0].analysers).toHaveLength(0)
    monitor.stop()
  })

  it('32. o vigia se aposenta no primeiro bloco: worklet saudável nunca vira fallback', async () => {
    vi.useFakeTimers()
    FakeAudioContext.workletBehavior = 'resolve'

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange: () => {} })
    await settle()
    FakeAudioWorkletNode.instances[0].postLevel(-80, 10)

    vi.advanceTimersByTime(10_000)

    expect(FakeAudioContext.instances[0].analysers).toHaveLength(0)
    monitor.stop()
  })

  it('33. `stop()` antes de o worklet carregar: nenhum nó nasce, nenhum fallback, contexto fechado', async () => {
    vi.useFakeTimers()
    FakeAudioContext.workletBehavior = 'manual'

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange: () => {} })
    const ctx = FakeAudioContext.instances[0]
    monitor.stop()

    ctx.finishAddModule()
    await settle()
    vi.advanceTimersByTime(5000)

    expect(FakeAudioWorkletNode.instances).toHaveLength(0)
    expect(ctx.analysers).toHaveLength(0)
    expect(ctx.closes).toBe(1)
  })

  it('34. `stop()` desmonta o worklet: bloco que chega depois não decide nada', async () => {
    FakeAudioContext.workletBehavior = 'resolve'
    const onSpeakingChange = vi.fn()

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange })
    await settle()
    const node = FakeAudioWorkletNode.instances[0]
    const ctx = FakeAudioContext.instances[0]

    monitor.stop()

    expect(node.port.onmessage).toBeNull()
    expect(node.disconnects).toBeGreaterThan(0)
    expect(ctx.gains[0].disconnects).toBeGreaterThan(0)
    node.postLevel(-10, 10)
    expect(onSpeakingChange).not.toHaveBeenCalled()
  })

  it('35. diagnóstico: UMA linha de info ao iniciar, com modo, limiar e caminho', async () => {
    FakeAudioContext.workletBehavior = 'resolve'

    const auto = createVadMonitor(track, {
      autoSensitivity: true,
      thresholdDb: -50,
      onSpeakingChange: () => {}
    })
    await settle()
    const text = loggedText(logged.info)
    expect(text).toContain('[voice]')
    expect(text).toMatch(/AudioWorklet/)
    expect(text).toMatch(/automático/)
    expect(text).toMatch(/-46 dB/)

    // Nada por bloco.
    const before = logged.info.length
    for (let t = 10; t <= 500; t += 10) FakeAudioWorkletNode.instances[0].postLevel(-30, t)
    expect(logged.info.length).toBe(before)
    auto.stop()

    logged.info = []
    const manualMonitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange: () => {} })
    await settle()
    expect(loggedText(logged.info)).toMatch(/manual \(limiar -50 dB\)/)
    manualMonitor.stop()
  })
  it('36. `addModule` que NUNCA assenta: o prazo nasce com o monitor e o fallback sobe em ~2 s', async () => {
    // Antes o vigia só era armado DEPOIS do `await addModule()`: pendente para
    // sempre = sem vigia, sem fallback, e o microfone (já mutado por quem
    // criou o monitor) fechado para sempre.
    vi.useFakeTimers()
    FakeAudioContext.workletBehavior = 'manual'
    FakeAnalyser.sample = 0.4
    const onSpeakingChange = vi.fn()

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange })
    await settle()
    const ctx = FakeAudioContext.instances[0]

    vi.advanceTimersByTime(1000)
    expect(ctx.analysers).toHaveLength(0)
    vi.advanceTimersByTime(1000)
    expect(ctx.analysers).toHaveLength(1)
    expect(loggedText(logged.warn)).toMatch(/fallback/i)

    vi.advanceTimersByTime(20)
    expect(onSpeakingChange).toHaveBeenCalledWith(true)
    monitor.stop()
  })

  it('37. `addModule` que resolve DEPOIS do fallback é ignorado: nenhum worklet nasce por cima', async () => {
    vi.useFakeTimers()
    FakeAudioContext.workletBehavior = 'manual'

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange: () => {} })
    await settle()
    const ctx = FakeAudioContext.instances[0]
    vi.advanceTimersByTime(2000)
    expect(ctx.analysers).toHaveLength(1)
    logged.info = []

    ctx.finishAddModule()
    await settle()

    expect(FakeAudioWorkletNode.instances).toHaveLength(0)
    expect(ctx.gains).toHaveLength(0)
    expect(loggedText(logged.info)).not.toMatch(/AudioWorklet/)
    monitor.stop()
  })

  it('38. nem worklet nem fallback: FALHA ABERTO — microfone aberto e erro no console, sem rejeição solta', async () => {
    vi.useFakeTimers()
    FakeAudioContext.workletBehavior = 'absent'
    FakeAudioContext.analyserThrows = true
    const onSpeakingChange = vi.fn()

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange })
    await settle()
    // O "abre" vai num macrotask, depois do mute síncrono de quem criou.
    expect(onSpeakingChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)

    expect(onSpeakingChange).toHaveBeenCalledTimes(1)
    expect(onSpeakingChange).toHaveBeenCalledWith(true)
    const text = loggedText(logged.error)
    expect(text).toContain('[voice]')
    expect(text).toMatch(/ABERTO/)
    expect(text).toContain('createAnalyser explodiu')
    monitor.stop()
  })

  it('39. fallback que lança a partir do VIGIA também falha aberto', async () => {
    vi.useFakeTimers()
    FakeAudioContext.workletBehavior = 'resolve'
    FakeAudioContext.analyserThrows = true
    const onSpeakingChange = vi.fn()

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange })
    await settle()

    expect(() => vi.advanceTimersByTime(2000)).not.toThrow()
    vi.advanceTimersByTime(1) // o "abre" adiado
    expect(onSpeakingChange).toHaveBeenCalledWith(true)
    expect(loggedText(logged.error)).toMatch(/ABERTO/)
    monitor.stop()
  })

  it('40. `stop()` entre a falha e o "abre" adiado: ninguém é chamado', async () => {
    vi.useFakeTimers()
    FakeAudioContext.workletBehavior = 'absent'
    FakeAudioContext.analyserThrows = true
    const onSpeakingChange = vi.fn()

    const monitor = createVadMonitor(track, { ...MANUAL, onSpeakingChange })
    await settle()
    monitor.stop()
    vi.advanceTimersByTime(10)

    expect(onSpeakingChange).not.toHaveBeenCalled()
  })
})
