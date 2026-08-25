// @vitest-environment jsdom
//
// Prova da ponte PCM -> MediaStreamTrack (Fase 8.6).
//
// **jsdom não tem Web Audio nenhum** — nem `AudioContext`, nem
// `AudioWorkletNode`, nem `MediaStreamAudioDestinationNode` — e este ambiente
// (WSL2) não tem placa de som nem Chromium com janela. Os duplos abaixo provam
// o CONTRATO da ponte: quem é construído, com quais argumentos, o que é
// conectado a quê, e que nada fica aberto. Eles NÃO provam que o Chromium
// carrega o worklet sob a CSP, nem que a track reporta `channelCount` — isso é
// do checkpoint 08.6-06 e está escrito no SUMMARY.
//
// A parte genuinamente provada aqui é `int16ToPlanarFloat32`: função pura,
// aritmética exata, sem ambiente nenhum no caminho.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import workletSource from './screenshare-audio-processor.js?raw'
import processorUrl from './screenshare-audio-processor.js?url'
import {
  createScreenShareAudioBridge,
  int16ToPlanarFloat32,
  SCREENSHARE_PCM_PROCESSOR_NAME
} from './screenshare-audio-bridge'

// --------------------------------------------------------------------------
// Duplos de Web Audio
// --------------------------------------------------------------------------

type Posted = { message: Record<string, unknown>; transfer?: unknown[] }

class FakeAudioWorkletNode {
  static instances: FakeAudioWorkletNode[] = []
  static shouldThrow = false

  port: {
    postMessage: (message: unknown, transfer?: unknown[]) => void
    onmessage: ((event: { data: unknown }) => void) | null
  }
  posted: Posted[] = []
  connectedTo: unknown[] = []
  disconnects = 0
  ctx: FakeAudioContext
  name: string
  options: unknown

  constructor(ctx: FakeAudioContext, name: string, options: unknown) {
    if (FakeAudioWorkletNode.shouldThrow) throw new Error('NotSupportedError: nome desconhecido')
    this.ctx = ctx
    this.name = name
    this.options = options
    this.port = {
      postMessage: (message: unknown, transfer?: unknown[]): void => {
        this.posted.push({ message: message as Record<string, unknown>, transfer })
      },
      onmessage: null
    }
    FakeAudioWorkletNode.instances.push(this)
  }

  connect(target: unknown): unknown {
    this.connectedTo.push(target)
    return target
  }

  disconnect(): void {
    this.disconnects++
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  static addModule: (url: string) => Promise<void> = () => Promise.resolve()
  static initialState = 'running'
  static emptyTrackList = false

  options: { sampleRate?: number; latencyHint?: string }
  state = FakeAudioContext.initialState
  closes = 0
  resumes = 0
  addModuleCalls: string[] = []
  /** A saída para os ALTO-FALANTES. Conectar aqui é o defeito que a fase mata. */
  destination = { role: 'speakers-do-usuario' }
  audioWorklet = {
    addModule: (url: string): Promise<void> => {
      this.addModuleCalls.push(url)
      return FakeAudioContext.addModule(url)
    }
  }

  constructor(options: { sampleRate?: number; latencyHint?: string } = {}) {
    this.options = options
    FakeAudioContext.instances.push(this)
  }

  createMediaStreamDestination(): {
    role: string
    stream: { getAudioTracks: () => unknown[] }
  } {
    return {
      role: 'media-stream-destination',
      stream: {
        getAudioTracks: (): unknown[] => (FakeAudioContext.emptyTrackList ? [] : [fakeTrack])
      }
    }
  }

  close(): Promise<void> {
    this.closes++
    this.state = 'closed'
    return Promise.resolve()
  }

  resume(): Promise<void> {
    this.resumes++
    this.state = 'running'
    return Promise.resolve()
  }
}

let fakeTrack: { kind: string; stop: ReturnType<typeof vi.fn> }

const FORMAT = { sampleRate: 48000, channels: 2, bitsPerSample: 16 }

/** Monta PCM s16le intercalado a partir de amostras, sempre little-endian. */
function pcm(samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  samples.forEach((sample, i) => view.setInt16(i * 2, sample, true))
  return bytes
}

beforeEach(() => {
  FakeAudioWorkletNode.instances = []
  FakeAudioWorkletNode.shouldThrow = false
  FakeAudioContext.instances = []
  FakeAudioContext.addModule = () => Promise.resolve()
  FakeAudioContext.initialState = 'running'
  FakeAudioContext.emptyTrackList = false
  fakeTrack = { kind: 'audio', stop: vi.fn() }

  const g = globalThis as unknown as Record<string, unknown>
  g.AudioContext = FakeAudioContext
  g.AudioWorkletNode = FakeAudioWorkletNode
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

// --------------------------------------------------------------------------
// int16ToPlanarFloat32 — a única parte provável de verdade neste ambiente
// --------------------------------------------------------------------------

describe('int16ToPlanarFloat32', () => {
  it('1. converte valores conhecidos com o divisor 32768 (não 32767)', () => {
    const { left, right } = int16ToPlanarFloat32(pcm([0, 0, 32767, 32767, -32768, -32768]), 2)

    expect(left[0]).toBe(0)
    expect(left[1]).toBe(32767 / 32768)
    expect(left[2]).toBe(-1)
    expect(right[2]).toBe(-1)

    // O motivo do 32768: com 32767, o mínimo de s16 viraria -1.0000305, FORA
    // do intervalo do Web Audio — distorção exatamente no pico.
    expect(left[2]).toBeGreaterThanOrEqual(-1)
    expect(left[1]).toBeLessThan(1)

    const meio = int16ToPlanarFloat32(pcm([16384, 16384]), 2)
    expect(meio.left[0]).toBe(0.5)
  })

  it('2. desintercala L R L R na ordem certa', () => {
    const { left, right } = int16ToPlanarFloat32(pcm([100, -100, 200, -200, 300, -300]), 2)

    expect(Array.from(left)).toEqual([100 / 32768, 200 / 32768, 300 / 32768])
    expect(Array.from(right)).toEqual([-100 / 32768, -200 / 32768, -300 / 32768])
  })

  it('3. mono duplica o canal em vez de deixar um lado mudo', () => {
    const { left, right } = int16ToPlanarFloat32(pcm([1000, 2000, 3000]), 1)

    expect(left.length).toBe(3)
    expect(Array.from(right)).toEqual(Array.from(left))
  })

  it('4. buffer truncado (frame incompleto / byte ímpar) descarta a sobra, sem lançar', () => {
    // 3 bytes: nem um sample estéreo completo.
    const impar = new Uint8Array([0x01, 0x02, 0x03])
    expect(() => int16ToPlanarFloat32(impar, 2)).not.toThrow()
    expect(int16ToPlanarFloat32(impar, 2).left.length).toBe(0)

    // 3 samples num fluxo estéreo: 1 frame bom + meio frame perdido.
    const meioFrame = pcm([500, -500, 700])
    const out = int16ToPlanarFloat32(meioFrame, 2)
    expect(out.left.length).toBe(1)
    expect(out.left[0]).toBe(500 / 32768)
    expect(out.right[0]).toBe(-500 / 32768)
  })

  it('5. buffer vazio devolve arrays vazios, sem lançar', () => {
    const out = int16ToPlanarFloat32(new Uint8Array(0), 2)
    expect(out.left.length).toBe(0)
    expect(out.right.length).toBe(0)
  })

  it('5b. respeita byteOffset — um Uint8Array que é VIEW de um buffer maior', () => {
    // O IPC pode entregar uma view com offset; ler o buffer inteiro leria lixo.
    const bruto = pcm([0, 0, 1234, -1234])
    const view = new Uint8Array(bruto.buffer, 4, 4)
    const out = int16ToPlanarFloat32(view, 2)
    expect(out.left[0]).toBe(1234 / 32768)
    expect(out.right[0]).toBe(-1234 / 32768)
  })
})

// --------------------------------------------------------------------------
// createScreenShareAudioBridge — contrato, com Web Audio dublado
// --------------------------------------------------------------------------

describe('createScreenShareAudioBridge', () => {
  it('o nome do processador não pode divergir do registerProcessor do worklet', () => {
    expect(workletSource).toContain(`registerProcessor('${SCREENSHARE_PCM_PROCESSOR_NAME}'`)
  })

  it('6. cria o AudioContext com o sampleRate DO FORMATO, nunca um literal do módulo', async () => {
    const bridge = await createScreenShareAudioBridge({ ...FORMAT, sampleRate: 44100 })

    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(FakeAudioContext.instances[0].options.sampleRate).toBe(44100)
    expect(FakeAudioContext.instances[0].options.latencyHint).toBe('interactive')
    await bridge.stop()

    const outro = await createScreenShareAudioBridge(FORMAT)
    expect(FakeAudioContext.instances[1].options.sampleRate).toBe(48000)
    await outro.stop()
  })

  it('7. carrega o worklet pela URL do asset (nunca data:/blob:) e usa o nome exportado', async () => {
    const bridge = await createScreenShareAudioBridge(FORMAT)

    expect(FakeAudioContext.instances[0].addModuleCalls).toEqual([processorUrl])
    expect(processorUrl).toContain('screenshare-audio-processor')
    // A CSP do app é `script-src 'self'`: `data:` e `blob:` são bloqueados
    // pelo Chromium, e o sintoma seria "sem som", sem erro de aplicação.
    expect(processorUrl.startsWith('data:')).toBe(false)
    expect(processorUrl.startsWith('blob:')).toBe(false)

    const node = FakeAudioWorkletNode.instances[0]
    expect(node.name).toBe(SCREENSHARE_PCM_PROCESSOR_NAME)
    expect(node.options).toMatchObject({
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    })
    await bridge.stop()
  })

  it('8. conecta ao MediaStreamDestination e NUNCA a ctx.destination (os alto-falantes)', async () => {
    const bridge = await createScreenShareAudioBridge(FORMAT)
    const ctx = FakeAudioContext.instances[0]
    const node = FakeAudioWorkletNode.instances[0]

    expect(node.connectedTo).toHaveLength(1)
    expect((node.connectedTo[0] as { role: string }).role).toBe('media-stream-destination')
    expect(node.connectedTo).not.toContain(ctx.destination)
    expect(bridge.track).toBe(fakeTrack)
    await bridge.stop()
  })

  it('9. pushChunk posta na porta com os DOIS ArrayBuffers como transferíveis', async () => {
    const bridge = await createScreenShareAudioBridge(FORMAT)
    const node = FakeAudioWorkletNode.instances[0]

    bridge.pushChunk(pcm([1000, -1000, 2000, -2000]))

    expect(node.posted).toHaveLength(1)
    const { message, transfer } = node.posted[0]
    expect(message.type).toBe('chunk')
    expect(transfer).toHaveLength(2)
    expect(transfer).toContain(message.left)
    expect(transfer).toContain(message.right)
    expect(new Float32Array(message.left as ArrayBuffer)[0]).toBe(1000 / 32768)
    expect(new Float32Array(message.right as ArrayBuffer)[0]).toBe(-1000 / 32768)

    // Chunk vazio não vira mensagem: nada de acordar o thread de áudio à toa.
    bridge.pushChunk(new Uint8Array(0))
    expect(node.posted).toHaveLength(1)
    await bridge.stop()
  })

  it('9b. pushChunk depois de stop() é no-op silencioso', async () => {
    const bridge = await createScreenShareAudioBridge(FORMAT)
    const node = FakeAudioWorkletNode.instances[0]
    await bridge.stop()
    const depoisDoFlush = node.posted.length

    expect(() => bridge.pushChunk(pcm([1, 2, 3, 4]))).not.toThrow()
    expect(node.posted).toHaveLength(depoisDoFlush)
  })

  it('10. stop() faz flush, desconecta, para a track e fecha o contexto — uma vez só', async () => {
    const bridge = await createScreenShareAudioBridge(FORMAT)
    const ctx = FakeAudioContext.instances[0]
    const node = FakeAudioWorkletNode.instances[0]

    await bridge.stop()

    expect(node.posted.map((p) => p.message.type)).toContain('flush')
    expect(node.disconnects).toBe(1)
    expect(fakeTrack.stop).toHaveBeenCalledTimes(1)
    expect(ctx.closes).toBe(1)
    expect(node.port.onmessage).toBeNull()

    // Idempotente: o usuário para o compartilhamento E o SDK despublica a track.
    await expect(bridge.stop()).resolves.toBeUndefined()
    await bridge.stop()
    expect(ctx.closes).toBe(1)
    expect(node.disconnects).toBe(1)
    expect(fakeTrack.stop).toHaveBeenCalledTimes(1)
  })

  it('10b. stop() não lança nem interrompe quando um passo falha no meio', async () => {
    const bridge = await createScreenShareAudioBridge(FORMAT)
    const ctx = FakeAudioContext.instances[0]
    const node = FakeAudioWorkletNode.instances[0]
    node.port.postMessage = (): void => {
      throw new Error('porta morta')
    }
    fakeTrack.stop.mockImplementation(() => {
      throw new Error('track já parada')
    })

    await expect(bridge.stop()).resolves.toBeUndefined()
    // O passo que mais importa (fechar o contexto) acontece mesmo assim.
    expect(ctx.closes).toBe(1)
    expect(node.disconnects).toBe(1)
  })

  it('11. addModule rejeitando -> a Promise rejeita citando a CSP E o contexto é fechado', async () => {
    FakeAudioContext.addModule = () => Promise.reject(new Error('Failed to fetch worklet'))

    await expect(createScreenShareAudioBridge(FORMAT)).rejects.toThrow(/CSP/)

    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(FakeAudioContext.instances[0].closes).toBe(1)
    expect(FakeAudioWorkletNode.instances).toHaveLength(0)
  })

  it('11b. falha ao montar o nó também fecha o contexto, sem vazar', async () => {
    FakeAudioWorkletNode.shouldThrow = true
    await expect(createScreenShareAudioBridge(FORMAT)).rejects.toThrow(/grafo de áudio/)
    expect(FakeAudioContext.instances[0].closes).toBe(1)
  })

  it('11c. destination sem track de áudio falha explicitamente e fecha o contexto', async () => {
    FakeAudioContext.emptyTrackList = true
    await expect(createScreenShareAudioBridge(FORMAT)).rejects.toThrow(/track/)
    expect(FakeAudioContext.instances[0].closes).toBe(1)
  })

  it('12. contexto que nasce suspenso é retomado — senão a track transmite silêncio eterno', async () => {
    FakeAudioContext.initialState = 'suspended'
    const bridge = await createScreenShareAudioBridge(FORMAT)

    expect(FakeAudioContext.instances[0].resumes).toBe(1)
    expect(FakeAudioContext.instances[0].state).toBe('running')
    await bridge.stop()
  })

  it('13. onStats recebe só as mensagens de stats do worklet', async () => {
    const onStats = vi.fn()
    const bridge = await createScreenShareAudioBridge(FORMAT, { onStats })
    const node = FakeAudioWorkletNode.instances[0]

    node.port.onmessage?.({ data: { type: 'stats', depth: 1440, depthMs: 30, underruns: 0 } })
    node.port.onmessage?.({ data: { type: 'outra-coisa' } })
    node.port.onmessage?.({ data: null })

    expect(onStats).toHaveBeenCalledTimes(1)
    expect(onStats).toHaveBeenCalledWith(expect.objectContaining({ depthMs: 30 }))
    await bridge.stop()
  })
})
