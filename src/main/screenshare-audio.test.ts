// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SCREENSHARE_AUDIO_CHANNELS, SILENCE_WATCHDOG_MS } from './screenshare-audio-types'

// O QUE ESTES TESTES PROVAM: o CONTRATO do módulo de áudio por processo — quem
// é chamado, com quais argumentos, em qual caminho, e principalmente que
// NENHUM caminho de saída deixa a captura nativa viva.
//
// O QUE ELES NÃO PROVAM, e nenhum teste daqui pode provar: que o WASAPI
// captura alguma coisa. Este ambiente é WSL2 — não há Windows, não há placa de
// som, e o `.node` do `loopback-capture` é PE32+ de Windows x64, que não
// carrega aqui de jeito nenhum. O addon é INJETADO (`__setModuleLoaderForTests`)
// justamente porque, sem injeção, o único caminho exercitável seria
// `addon-unavailable` — que é, de fato, o único que roda de verdade nesta
// máquina.
//
// Que `start(pid, false, cb)` não lança no Windows, que chegam chunks, e
// sobretudo que a voz dos outros participantes NÃO está neles (a premissa da
// árvore de processos do Chromium) é o checkpoint humano 08.6-06. Nada aqui
// substitui aquilo.

const { ipcMainHandleMock, ipcMainOnMock, appOnMock, releaseMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
  ipcMainOnMock: vi.fn(),
  appOnMock: vi.fn(),
  releaseMock: vi.fn(() => '10.0.26100')
}))

vi.mock('electron', () => ({
  ipcMain: { handle: ipcMainHandleMock, on: ipcMainOnMock },
  app: { on: appOnMock }
}))

vi.mock('os', () => ({ release: releaseMock }))

type FakeInstance = {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  /** O callback que o módulo passou ao addon — o cano por onde os chunks entram. */
  emit: (chunk: Buffer) => void
}

type FakeAddon = {
  loader: () => unknown
  instances: FakeInstance[]
  loaderCalls: () => number
}

/**
 * Um duplo do addon nativo. `startImpl` permite fazer o `start()` lançar, que é
 * como o pacote reporta HRESULT.
 */
function fakeAddon(startImpl?: (pid: number, includeProcessTree: boolean) => void): FakeAddon {
  const instances: FakeInstance[] = []
  let loaderCalls = 0

  class FakeCapture {
    private cb: ((chunk: Buffer) => void) | null = null
    start = vi.fn((pid: number, includeProcessTree: boolean, cb: (chunk: Buffer) => void) => {
      this.cb = cb
      startImpl?.(pid, includeProcessTree)
    })
    stop = vi.fn()
    constructor() {
      instances.push({
        // Os casts existem porque o `Mock` tipado do vitest não é atribuível ao
        // `Mock<any[], unknown>` genérico do alias — ruído de tipo, não de contrato.
        start: this.start as never,
        stop: this.stop as never,
        emit: (chunk) => this.cb?.(chunk)
      })
    }
  }

  return {
    loader: () => {
      loaderCalls += 1
      return { LoopbackCapture: FakeCapture }
    },
    instances,
    loaderCalls: () => loaderCalls
  }
}

type Module = typeof import('./screenshare-audio')

const realPlatform = process.platform

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

/**
 * Carrega o módulo do zero — a captura ativa, o cache do addon e a guarda de
 * registro são estado de módulo — com a plataforma, o `os.release()` e o loader
 * do addon já no lugar.
 */
async function load(options?: {
  platform?: string
  release?: string
  loader?: () => unknown
}): Promise<Module> {
  setPlatform(options?.platform ?? 'win32')
  releaseMock.mockReturnValue(options?.release ?? '10.0.26100')
  vi.resetModules()
  const mod = await import('./screenshare-audio')
  mod.__setModuleLoaderForTests((options?.loader ?? null) as never)
  return mod
}

/** O `send` que o módulo usa: devolve `true` quando entregou, `false` quando não há janela. */
function sender(delivered = true): ReturnType<typeof vi.fn> {
  return vi.fn(() => delivered) as never
}

function statusesFrom(send: ReturnType<typeof vi.fn>): unknown[] {
  return send.mock.calls
    .filter((call) => call[0] === SCREENSHARE_AUDIO_CHANNELS.STATUS)
    .map((call) => call[1])
}

describe('screenshare-audio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    setPlatform(realPlatform)
  })

  describe('portão de capacidade', () => {
    it('reprova fora do Windows sem sequer tocar no addon', async () => {
      const addon = fakeAddon()
      const mod = await load({ platform: 'linux', loader: addon.loader })

      expect(mod.isProcessAudioSupported()).toEqual({ supported: false, reason: 'not-windows' })
      // Carregar o `.node` aqui é o que derrubaria o processo main em dev.
      expect(addon.loaderCalls()).toBe(0)
    })

    // Windows 10 22H2 APROVA desde 2026-08-20: a documentação da Microsoft diz
    // 20348, mas descreve o SDK, não o binário — o fonte de produção do OBS usa
    // 19041 desde 2021 e há relatos de captura por aplicativo em 19045. Quem
    // decide de verdade é o `start()`, tratando o HRESULT.
    it('aprova Windows 10 22H2 (build 19045) e carrega o addon', async () => {
      const addon = fakeAddon()
      const mod = await load({ release: '10.0.19045', loader: addon.loader })

      expect(mod.isProcessAudioSupported()).toMatchObject({ supported: true })
      expect(addon.loaderCalls()).toBe(1)
    })

    it('reprova Windows 10 1909 (build 18363, anterior à API) e diz qual é o release', async () => {
      const addon = fakeAddon()
      const mod = await load({ release: '10.0.18363', loader: addon.loader })

      const capability = mod.isProcessAudioSupported()
      expect(capability).toMatchObject({ supported: false, reason: 'windows-too-old' })
      expect(capability.supported === false && capability.detail).toContain('18363')
      expect(addon.loaderCalls()).toBe(0)
    })

    it('aprova Windows 11 (build 26100) e carrega o addon', async () => {
      const addon = fakeAddon()
      const mod = await load({ release: '10.0.26100', loader: addon.loader })

      expect(mod.isProcessAudioSupported()).toEqual({ supported: true })
      expect(addon.loaderCalls()).toBe(1)
    })

    it('NÃO reprova quando o release é ilegível — o portão que vale é tentar', async () => {
      const addon = fakeAddon()
      const mod = await load({ release: 'unknown', loader: addon.loader })

      expect(mod.isProcessAudioSupported()).toEqual({ supported: true })
      expect(addon.loaderCalls()).toBe(1)
    })

    it('vira addon-unavailable quando o require falha, com o motivo no detail', async () => {
      const loader = vi.fn(() => {
        throw new Error('Cannot find module loopback-capture')
      })
      const mod = await load({ loader })

      const capability = mod.isProcessAudioSupported()
      expect(capability).toMatchObject({ supported: false, reason: 'addon-unavailable' })
      expect(capability.supported === false && capability.detail).toContain(
        'Cannot find module loopback-capture'
      )
    })

    it('cacheia o resultado do require — sucesso e falha — em vez de tentar 100 vezes', async () => {
      const failing = vi.fn(() => {
        throw new Error('sem .node')
      })
      const mod = await load({ loader: failing })

      mod.isProcessAudioSupported()
      mod.isProcessAudioSupported()
      mod.isProcessAudioSupported()

      expect(failing).toHaveBeenCalledTimes(1)
    })
  })

  describe('start', () => {
    it('chama start com EXATAMENTE (process.pid, false, fn) — o modo EXCLUIR', async () => {
      // ESTE É O TESTE DA FASE. `false` =
      // PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE: capture o sistema
      // inteiro TIRANDO este processo e seus filhos. Se alguém trocar por
      // `true`, a captura passa a ser SÓ do próprio app (o eco puro) e é aqui
      // que estoura.
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })

      mod.startScreenShareAudioCapture(sender() as never)

      expect(addon.instances).toHaveLength(1)
      expect(addon.instances[0].start).toHaveBeenCalledTimes(1)
      expect(addon.instances[0].start).toHaveBeenCalledWith(
        process.pid,
        false,
        expect.any(Function)
      )
    })

    it('devolve ok com o formato fixado no C++ do pacote e anuncia "capturing"', async () => {
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })
      const send = sender()

      const result = mod.startScreenShareAudioCapture(send as never)

      expect(result).toEqual({
        ok: true,
        format: { sampleRate: 48000, channels: 2, bitsPerSample: 16 }
      })
      expect(statusesFrom(send)).toContainEqual({ kind: 'capturing' })
    })

    it('degrada para "sem áudio com motivo" quando a máquina não passa no portão', async () => {
      const addon = fakeAddon()
      const mod = await load({ platform: 'linux', loader: addon.loader })
      const send = sender()

      const result = mod.startScreenShareAudioCapture(send as never)

      expect(result).toEqual({ ok: false, reason: 'not-windows' })
      expect(statusesFrom(send)).toContainEqual({ kind: 'failed', reason: 'not-windows' })
      expect(addon.instances).toHaveLength(0)
    })

    it('preserva o HRESULT quando o start do addon lança, e a Promise do IPC RESOLVE', async () => {
      const addon = fakeAddon(() => {
        throw new Error('Failed to start loopback capture (HRESULT 0x88890008)')
      })
      const mod = await load({ loader: addon.loader })
      mod.registerScreenShareAudioHandlers(() => fakeWindow() as never)

      const handler = ipcMainHandleMock.mock.calls.find(
        (call) => call[0] === SCREENSHARE_AUDIO_CHANNELS.START
      )?.[1] as () => Promise<{ ok: boolean; reason?: string; detail?: string }>

      // Resolve, nunca rejeita: "não deu, e o motivo é este" é informação de
      // produto, não exceção de IPC para ninguém tratar.
      const result = await handler()
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('start-failed')
      expect(result.detail).toContain('0x88890008')
    })

    it('para a captura anterior e cria uma instância NOVA a cada transmissão', async () => {
      // Uma instância = uma captura: `start()` numa instância já iniciada LANÇA
      // ("Capture already started on this instance").
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })

      mod.startScreenShareAudioCapture(sender() as never)
      mod.startScreenShareAudioCapture(sender() as never)

      expect(addon.instances).toHaveLength(2)
      expect(addon.instances[0].stop).toHaveBeenCalledTimes(1)
      expect(addon.instances[1].stop).not.toHaveBeenCalled()
    })
  })

  describe('chunks e watchdog', () => {
    it('encaminha cada chunk ao renderer com o mesmo conteúdo', async () => {
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })
      const send = sender()
      mod.startScreenShareAudioCapture(send as never)

      const chunk = Buffer.from([1, 2, 3, 4])
      addon.instances[0].emit(chunk)

      const chunkCalls = send.mock.calls.filter(
        (call) => call[0] === SCREENSHARE_AUDIO_CHANNELS.CHUNK
      )
      expect(chunkCalls).toHaveLength(1)
      expect(chunkCalls[0][1]).toBe(chunk)
    })

    it('não deixa exceção do send vazar para o addon nem derrubar a captura', async () => {
      // O callback vem de uma Napi::ThreadSafeFunction: exceção que escape
      // atravessa a fronteira do addon.
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })
      const send = vi.fn(() => {
        throw new Error('webContents destruído')
      })
      mod.startScreenShareAudioCapture(send as never)

      expect(() => addon.instances[0].emit(Buffer.from([9]))).not.toThrow()
      expect(addon.instances[0].stop).not.toHaveBeenCalled()
    })

    it('agenda a parada quando não há mais janela para receber o chunk', async () => {
      vi.useFakeTimers()
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })
      // `false` = janela destruída. Não é erro: é caminho de saída.
      mod.startScreenShareAudioCapture(sender(false) as never)

      addon.instances[0].emit(Buffer.from([1]))
      expect(addon.instances[0].stop).not.toHaveBeenCalled()

      // Agendada, e não síncrona: `stop()` bloqueia, e estamos dentro da
      // entrega do addon.
      vi.advanceTimersByTime(1)
      expect(addon.instances[0].stop).toHaveBeenCalledTimes(1)
    })

    it('avisa "no-audio-yet" depois do prazo, SEM parar a captura', async () => {
      vi.useFakeTimers()
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })
      const send = sender()
      mod.startScreenShareAudioCapture(send as never)

      vi.advanceTimersByTime(SILENCE_WATCHDOG_MS)

      expect(statusesFrom(send)).toContainEqual({ kind: 'no-audio-yet' })
      // Silêncio não é falha: o addon descarta buffer mudo (-70 dBFS), então
      // "nenhum chunk" pode ser só um trecho quieto.
      expect(addon.instances[0].stop).not.toHaveBeenCalled()
    })

    it('não dispara o watchdog quando um chunk chegou antes do prazo', async () => {
      vi.useFakeTimers()
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })
      const send = sender()
      mod.startScreenShareAudioCapture(send as never)

      vi.advanceTimersByTime(SILENCE_WATCHDOG_MS - 1)
      addon.instances[0].emit(Buffer.from([1, 2]))
      vi.advanceTimersByTime(SILENCE_WATCHDOG_MS * 2)

      expect(statusesFrom(send)).not.toContainEqual({ kind: 'no-audio-yet' })
    })
  })

  describe('teardown — a Armadilha 5 (captura nativa viva depois do fim)', () => {
    it('é idempotente: parar duas vezes chama stop() do addon uma vez só', async () => {
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })
      const send = sender()
      mod.startScreenShareAudioCapture(send as never)

      mod.stopScreenShareAudioCapture()
      mod.stopScreenShareAudioCapture()
      mod.stopScreenShareAudioCapture()

      expect(addon.instances[0].stop).toHaveBeenCalledTimes(1)
      expect(
        statusesFrom(send).filter((s) => JSON.stringify(s) === '{"kind":"stopped"}')
      ).toHaveLength(1)
    })

    it('não reentra: um stop disparado de dentro do próprio teardown é no-op', async () => {
      // O caso que a idempotência SEQUENCIAL não pega, e o que realmente
      // acontece na máquina: `capture.stop()` BLOQUEIA até o Media Foundation
      // confirmar, e durante esse bloqueio ainda chegam eventos (um último
      // chunk, o `destroyed` do webContents que o próprio teardown provoca).
      // Se o estado só fosse zerado no FIM do teardown, essa reentrada
      // chamaria `capture.stop()` de novo — parada dupla, ou recursão infinita.
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })
      mod.startScreenShareAudioCapture(sender() as never)

      let reentered = false
      addon.instances[0].stop.mockImplementation(() => {
        if (reentered) return
        reentered = true
        mod.stopScreenShareAudioCapture()
      })

      mod.stopScreenShareAudioCapture()

      expect(reentered).toBe(true)
      expect(addon.instances[0].stop).toHaveBeenCalledTimes(1)
    })

    it('sem captura ativa é no-op silencioso e não lança', async () => {
      const mod = await load({ loader: fakeAddon().loader })
      expect(() => mod.stopScreenShareAudioCapture()).not.toThrow()
    })

    it('sobrevive a um stop() do addon que lança, e ainda zera o estado', async () => {
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })
      mod.startScreenShareAudioCapture(sender() as never)
      addon.instances[0].stop.mockImplementation(() => {
        throw new Error('MF não confirmou a parada')
      })

      expect(() => mod.stopScreenShareAudioCapture()).not.toThrow()

      // Estado zerado de verdade: o start seguinte funciona e cria instância nova.
      const result = mod.startScreenShareAudioCapture(sender() as never)
      expect(result).toMatchObject({ ok: true })
      expect(addon.instances).toHaveLength(2)
    })

    it('um chunk que chega durante a parada não é encaminhado', async () => {
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })
      const send = sender()
      mod.startScreenShareAudioCapture(send as never)
      addon.instances[0].stop.mockImplementation(() => {
        // `stop()` bloqueia; o addon ainda pode entregar o que estava na fila.
        addon.instances[0].emit(Buffer.from([1, 2, 3]))
      })

      mod.stopScreenShareAudioCapture()

      expect(
        send.mock.calls.filter((call) => call[0] === SCREENSHARE_AUDIO_CHANNELS.CHUNK)
      ).toHaveLength(0)
    })

    it('caminho 1 — o canal STOP do IPC para a captura', async () => {
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })
      mod.registerScreenShareAudioHandlers(() => fakeWindow() as never)
      mod.startScreenShareAudioCapture(sender() as never)

      emitIpc(SCREENSHARE_AUDIO_CHANNELS.STOP)

      expect(addon.instances[0].stop).toHaveBeenCalledTimes(1)
    })

    it('caminho 2 — o renderer recarregando (F5/HMR) para a captura', async () => {
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })
      const target = fakeTarget()
      mod.startScreenShareAudioCapture(sender() as never, target as never)

      target.fire('did-start-navigation', { isInPlace: false, isMainFrame: true })

      expect(addon.instances[0].stop).toHaveBeenCalledTimes(1)
    })

    it('não para por navegação in-place (um compartilhamento não morre à toa)', async () => {
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })
      const target = fakeTarget()
      mod.startScreenShareAudioCapture(sender() as never, target as never)

      target.fire('did-start-navigation', { isInPlace: true, isMainFrame: true })

      expect(addon.instances[0].stop).not.toHaveBeenCalled()
    })

    it('caminho 3 — a janela destruída para a captura, e os listeners saem junto', async () => {
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })
      const target = fakeTarget()
      mod.startScreenShareAudioCapture(sender() as never, target as never)

      target.fire('destroyed')

      expect(addon.instances[0].stop).toHaveBeenCalledTimes(1)
      // Sem isto, cada transmissão empilharia um par de listeners no webContents.
      expect(target.listenerCount()).toBe(0)
    })

    it('caminho 4 — o app encerrando (before-quit) para a captura', async () => {
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })
      mod.registerScreenShareAudioHandlers(() => fakeWindow() as never)
      mod.startScreenShareAudioCapture(sender() as never)

      const beforeQuit = appOnMock.mock.calls.find((call) => call[0] === 'before-quit')?.[1] as
        (() => void) | undefined
      expect(beforeQuit).toBeTypeOf('function')
      beforeQuit?.()

      expect(addon.instances[0].stop).toHaveBeenCalledTimes(1)
    })
  })

  describe('registro', () => {
    it('avisa e ignora o segundo registro, sem empilhar listeners', async () => {
      const mod = await load({ loader: fakeAddon().loader })

      mod.registerScreenShareAudioHandlers(() => fakeWindow() as never)
      const handlesAfterFirst = ipcMainHandleMock.mock.calls.length
      const onsAfterFirst = ipcMainOnMock.mock.calls.length

      mod.registerScreenShareAudioHandlers(() => fakeWindow() as never)

      expect(ipcMainHandleMock.mock.calls.length).toBe(handlesAfterFirst)
      expect(ipcMainOnMock.mock.calls.length).toBe(onsAfterFirst)
      expect(console.warn).toHaveBeenCalled()
    })

    it('o start via IPC entrega os chunks ao webContents da janela viva', async () => {
      const addon = fakeAddon()
      const mod = await load({ loader: addon.loader })
      const window = fakeWindow()
      mod.registerScreenShareAudioHandlers(() => window as never)

      const handler = ipcMainHandleMock.mock.calls.find(
        (call) => call[0] === SCREENSHARE_AUDIO_CHANNELS.START
      )?.[1] as () => Promise<unknown>
      await handler()

      const chunk = Buffer.from([7, 7])
      addon.instances[0].emit(chunk)

      expect(window.webContents.send).toHaveBeenCalledWith(SCREENSHARE_AUDIO_CHANNELS.CHUNK, chunk)
    })
  })
})

/** Dispara os listeners de `ipcMain.on` daquele canal, como o renderer faria. */
function emitIpc(channel: string, ...args: unknown[]): void {
  for (const call of ipcMainOnMock.mock.calls.filter((c) => c[0] === channel)) {
    ;(call[1] as (event: unknown, ...rest: unknown[]) => void)({}, ...args)
  }
}

type FakeWindow = {
  isDestroyed: () => boolean
  webContents: {
    send: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    removeListener: ReturnType<typeof vi.fn>
  }
}

function fakeWindow(destroyed = false): FakeWindow {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn(), on: vi.fn(), removeListener: vi.fn() }
  }
}

/** Um duplo do `webContents` só com o que o teardown observa. */
function fakeTarget(): {
  on: (event: string, listener: (...args: unknown[]) => void) => void
  removeListener: (event: string, listener: (...args: unknown[]) => void) => void
  fire: (event: string, ...args: unknown[]) => void
  listenerCount: () => number
} {
  const listeners: Array<{ event: string; listener: (...args: unknown[]) => void }> = []
  return {
    on: (event, listener) => {
      listeners.push({ event, listener })
    },
    removeListener: (event, listener) => {
      const index = listeners.findIndex((l) => l.event === event && l.listener === listener)
      if (index >= 0) listeners.splice(index, 1)
    },
    fire: (event, ...args) => {
      for (const entry of [...listeners].filter((l) => l.event === event)) entry.listener(...args)
    },
    listenerCount: () => listeners.length
  }
}
