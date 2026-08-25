// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PICKER_TIMEOUT_MS, SCREENSHARE_CHANNELS } from './screenshare-types'

// Pitfall 2 (PITFALLS.md) é a razão deste arquivo existir: um handler de
// `setDisplayMediaRequestHandler` que termina sem chamar `callback` deixa a
// Promise de `getDisplayMedia()` pendurada para sempre no renderer — a UI
// fica carregando e TODA tentativa seguinte de compartilhar na mesma sessão
// trava junto. É um defeito silencioso (nenhum erro, nenhum log) e só
// aparece nos caminhos que a verificação manual feliz nunca percorre. Aqui
// cada caminho do handler é forçado e se cobra exatamente UMA chamada a
// `callback` em cada um.
//
// O Plano 08-04 multiplicou esses caminhos: a escolha agora vai e volta ao
// renderer, então existem cancelamento, id desconhecido, timeout, janela
// ausente, falha de envio e pedidos concorrentes — todos capazes de terminar
// em zero `callback` se alguém errar. São eles a maior parte deste arquivo.
//
// Não é substituto do checkpoint humano do Plano 08-03/08-07: isto prova o
// contrato do handler, não que a captura funciona (WSL2 não tem tela nem
// áudio, e `desktopCapturer` real nunca roda aqui).

const { getSourcesMock, setDisplayMediaRequestHandlerMock, ipcMainOnMock } = vi.hoisted(() => ({
  getSourcesMock: vi.fn(),
  setDisplayMediaRequestHandlerMock: vi.fn(),
  ipcMainOnMock: vi.fn()
}))

vi.mock('electron', () => ({
  desktopCapturer: { getSources: getSourcesMock },
  ipcMain: { on: ipcMainOnMock },
  session: {
    defaultSession: { setDisplayMediaRequestHandler: setDisplayMediaRequestHandlerMock }
  }
}))

type Streams = { video?: { id: string; name: string }; audio?: string }
type DisplayMediaHandler = (request: unknown, callback: (streams: Streams) => void) => Promise<void>

// O que o Chromium entrega ao handler. `audioRequested` é a metade do E
// lógico que o renderer controla (a constraint de `getDisplayMedia`); a outra
// metade é o toggle do seletor, que chega em `choice()` abaixo. Concessão de
// loopback = as duas verdadeiras.
const AUDIO_REQUESTED = { audioRequested: true }
const AUDIO_NOT_REQUESTED = { audioRequested: false }

/** O payload de `choose-source`: fonte + decisão sobre o áudio de sistema. */
function choice(sourceId: string, systemAudio = true): unknown {
  return { sourceId, systemAudio }
}
type FakeWindow = {
  isDestroyed: () => boolean
  webContents: { send: ReturnType<typeof vi.fn> }
}

/** Uma fonte no formato que `desktopCapturer.getSources` devolve. */
function fakeSource(id: string, name: string, withIcon = false): unknown {
  return {
    id,
    name,
    thumbnail: { toDataURL: (): string => `data:image/png;base64,thumb-${id}` },
    appIcon: withIcon ? { toDataURL: (): string => `data:image/png;base64,icon-${id}` } : null
  }
}

function fakeWindow(destroyed = false): FakeWindow {
  return { isDestroyed: () => destroyed, webContents: { send: vi.fn() } }
}

type Harness = {
  handler: DisplayMediaHandler
  window: FakeWindow
  /** Dispara os listeners de `ipcMain.on` daquele canal, como o renderer faria. */
  emit: (channel: string, ...args: unknown[]) => void
  listenerCount: (channel: string) => number
}

/**
 * Carrega o módulo do zero (o guarda de registro e a escolha pendente são
 * estado de módulo) e devolve o handler registrado + o canal de volta do
 * renderer.
 */
async function setup(window: FakeWindow | null = fakeWindow()): Promise<Harness> {
  vi.resetModules()
  const { registerScreenShareHandler } = await import('./screenshare')
  registerScreenShareHandler(() => window as never)
  const lastCall = setDisplayMediaRequestHandlerMock.mock.calls.at(-1)
  if (!lastCall) throw new Error('setDisplayMediaRequestHandler não foi chamado')
  return {
    handler: lastCall[0] as DisplayMediaHandler,
    window: window ?? fakeWindow(),
    emit: (channel, ...args) => {
      for (const call of ipcMainOnMock.mock.calls.filter((c) => c[0] === channel)) {
        ;(call[1] as (event: unknown, ...rest: unknown[]) => void)({}, ...args)
      }
    },
    listenerCount: (channel) => ipcMainOnMock.mock.calls.filter((c) => c[0] === channel).length
  }
}

/** Espera o seletor ter sido enviado ao renderer antes de responder por ele. */
async function waitForPicker(window: FakeWindow): Promise<void> {
  await vi.waitFor(() => expect(window.webContents.send).toHaveBeenCalled())
}

describe('registerScreenShareHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // A linha de diagnóstico da concessão (`[screenshare] concedendo
    // captura: ...`) é útil no app e ruído aqui.
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('enumeração de fontes', () => {
    it('pede telas E janelas, com miniatura de verdade e ícone de app', async () => {
      getSourcesMock.mockResolvedValue([fakeSource('screen:0:0', 'Tela 1')])
      const { handler, window, emit } = await setup()

      const done = handler(AUDIO_REQUESTED, vi.fn())
      await waitForPicker(window)

      // `types: ['screen']` e `thumbnailSize: { 0, 0 }` eram a versão sem
      // seletor do Plano 08-02. Com o diálogo, os dois voltam a valer — sem
      // miniatura o seletor mostra cards vazios, e sem 'window' o usuário só
      // consegue compartilhar telas inteiras.
      expect(getSourcesMock).toHaveBeenCalledWith({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true
      })

      emit(SCREENSHARE_CHANNELS.CANCEL_PICKER)
      await done
    })

    it('chama callback({}) quando não há nenhuma fonte disponível', async () => {
      getSourcesMock.mockResolvedValue([])
      const { handler, window } = await setup()

      const callback = vi.fn()
      await handler(AUDIO_REQUESTED, callback)

      // `{}` é o cancelamento explícito documentado; `{ video: undefined }`
      // não é a mesma coisa e é exatamente o erro que o Pitfall 2 descreve.
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith({})
      // Lista vazia não pode depender do renderer para se resolver.
      expect(window.webContents.send).not.toHaveBeenCalled()
    })

    it('chama callback({}) quando desktopCapturer.getSources rejeita', async () => {
      getSourcesMock.mockRejectedValue(new Error('captura indisponível'))
      const { handler } = await setup()

      const callback = vi.fn()
      await handler(AUDIO_REQUESTED, callback)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith({})
    })

    it('não deixa a exceção de getSources escapar do handler', async () => {
      getSourcesMock.mockRejectedValue(new Error('captura indisponível'))
      const { handler } = await setup()

      // Se a rejeição escapasse, isto viraria unhandled rejection no processo
      // main — que é o outro sintoma descrito no Pitfall 2.
      await expect(handler(AUDIO_REQUESTED, vi.fn())).resolves.not.toThrow()
    })
  })

  describe('envio da lista ao renderer', () => {
    it('serializa thumbnail e ícone como data URL e marca tela vs. janela', async () => {
      getSourcesMock.mockResolvedValue([
        fakeSource('screen:0:0', 'Tela 1'),
        fakeSource('window:42:0', 'Navegador', true)
      ])
      const { handler, window, emit } = await setup()

      const done = handler(AUDIO_REQUESTED, vi.fn())
      await waitForPicker(window)

      // `NativeImage` NÃO atravessa o IPC do Electron — chegaria como `{}` do
      // outro lado, e o seletor mostraria cards vazios sem nenhum erro.
      expect(window.webContents.send).toHaveBeenCalledWith(SCREENSHARE_CHANNELS.PICK_REQUESTED, {
        sources: [
          {
            id: 'screen:0:0',
            name: 'Tela 1',
            thumbnailDataUrl: 'data:image/png;base64,thumb-screen:0:0',
            isScreen: true
          },
          {
            id: 'window:42:0',
            name: 'Navegador',
            thumbnailDataUrl: 'data:image/png;base64,thumb-window:42:0',
            appIconDataUrl: 'data:image/png;base64,icon-window:42:0',
            isScreen: false
          }
        ],
        audioAvailable: true
      })

      emit(SCREENSHARE_CHANNELS.CANCEL_PICKER)
      await done
    })

    it('conta ao seletor se o áudio sequer foi pedido nesta captura', async () => {
      getSourcesMock.mockResolvedValue([fakeSource('screen:0:0', 'Tela 1')])
      const { handler, window, emit } = await setup()

      const done = handler(AUDIO_NOT_REQUESTED, vi.fn())
      await waitForPicker(window)

      // Sem isto o diálogo mentiria: o usuário ligaria o toggle e não sairia
      // som nenhum, porque a constraint desta chamada de `getDisplayMedia`
      // já foi fechada antes de o seletor abrir.
      expect(window.webContents.send).toHaveBeenCalledWith(
        SCREENSHARE_CHANNELS.PICK_REQUESTED,
        expect.objectContaining({ audioAvailable: false })
      )

      emit(SCREENSHARE_CHANNELS.CANCEL_PICKER)
      await done
    })

    it('chama callback({}) quando não existe janela para exibir o seletor', async () => {
      getSourcesMock.mockResolvedValue([fakeSource('screen:0:0', 'Tela 1')])
      const { handler } = await setup(null)

      const callback = vi.fn()
      await handler(AUDIO_REQUESTED, callback)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith({})
    })

    it('chama callback({}) quando a janela já foi destruída', async () => {
      getSourcesMock.mockResolvedValue([fakeSource('screen:0:0', 'Tela 1')])
      const { handler } = await setup(fakeWindow(true))

      const callback = vi.fn()
      await handler(AUDIO_REQUESTED, callback)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith({})
    })

    it('chama callback({}) quando o envio ao renderer lança', async () => {
      getSourcesMock.mockResolvedValue([fakeSource('screen:0:0', 'Tela 1')])
      const window = fakeWindow()
      window.webContents.send.mockImplementation(() => {
        throw new Error('webContents destruído')
      })
      const { handler } = await setup(window)

      const callback = vi.fn()
      await handler(AUDIO_REQUESTED, callback)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith({})
    })
  })

  describe('resposta do usuário', () => {
    it('concede a fonte escolhida com loopback quando os DOIS lados querem áudio', async () => {
      const screen = fakeSource('screen:0:0', 'Tela 1')
      const chosen = fakeSource('window:42:0', 'Navegador', true)
      getSourcesMock.mockResolvedValue([screen, chosen])
      const { handler, window, emit } = await setup()

      const callback = vi.fn()
      const done = handler(AUDIO_REQUESTED, callback)
      await waitForPicker(window)
      emit(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, choice('window:42:0'))
      await done

      // A fonte concedida é a ESCOLHIDA, não `sources[0]` (Plano 08-02).
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith({ video: chosen, audio: 'loopback' })
    })

    it('chama callback({}) exatamente uma vez quando o usuário cancela', async () => {
      getSourcesMock.mockResolvedValue([fakeSource('screen:0:0', 'Tela 1')])
      const { handler, window, emit } = await setup()

      const callback = vi.fn()
      const done = handler(AUDIO_REQUESTED, callback)
      await waitForPicker(window)
      emit(SCREENSHARE_CHANNELS.CANCEL_PICKER)
      await done

      // Este é O caminho novo do Plano 08-04 e o mais fácil de deixar
      // pendurado: ninguém escolheu nada, e mesmo assim `callback` precisa
      // ser chamado — senão a próxima tentativa de compartilhar trava junto.
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith({})
    })

    it('trata id desconhecido como cancelamento, sem pendurar a Promise', async () => {
      getSourcesMock.mockResolvedValue([fakeSource('screen:0:0', 'Tela 1')])
      const { handler, window, emit } = await setup()

      const callback = vi.fn()
      const done = handler(AUDIO_REQUESTED, callback)
      await waitForPicker(window)
      emit(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, choice('window:999:0'))
      await done

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith({})
    })

    it('trata payload sem sourceId como cancelamento', async () => {
      getSourcesMock.mockResolvedValue([fakeSource('screen:0:0', 'Tela 1')])
      const { handler, window, emit } = await setup()

      const callback = vi.fn()
      const done = handler(AUDIO_REQUESTED, callback)
      await waitForPicker(window)
      emit(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, { id: 'screen:0:0' })
      await done

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith({})
    })

    it('ignora respostas repetidas — cancelar depois de escolher não chama callback de novo', async () => {
      const screen = fakeSource('screen:0:0', 'Tela 1')
      getSourcesMock.mockResolvedValue([screen])
      const { handler, window, emit } = await setup()

      const callback = vi.fn()
      const done = handler(AUDIO_REQUESTED, callback)
      await waitForPicker(window)
      emit(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, choice('screen:0:0'))
      emit(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, choice('screen:0:0'))
      emit(SCREENSHARE_CHANNELS.CANCEL_PICKER)
      await done

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith({ video: screen, audio: 'loopback' })
    })

    it('não quebra com resposta do renderer sem nenhuma escolha pendente', async () => {
      getSourcesMock.mockResolvedValue([fakeSource('screen:0:0', 'Tela 1')])
      const { emit } = await setup()

      expect(() => emit(SCREENSHARE_CHANNELS.CANCEL_PICKER)).not.toThrow()
      expect(() => emit(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, choice('screen:0:0'))).not.toThrow()
    })
  })

  // ------------------------------------------------------------------
  // Pitfall 1 (PITFALLS.md), confirmado em uso real em 2026-08-20: com 4
  // pessoas numa call, quem compartilhava tela com áudio fazia as outras 3 se
  // ouvirem. O loopback do WASAPI captura tudo que sai pelo dispositivo de
  // saída, inclusive a voz que o próprio app está tocando, e `restrictOwnAudio`
  // não bastou.
  //
  // A concessão é o único lugar onde a captura de fato nasce — pedir não é
  // conceder. Estes testes cobram o E lógico: loopback só quando o renderer
  // pediu áudio E o usuário deixou o toggle ligado. Qualquer outro caso
  // precisa sair SEM a chave `audio`, porque é isso que garante eco zero por
  // construção, sem depender de o Chromium honrar constraint nenhuma.
  // ------------------------------------------------------------------
  describe('concessão do áudio de sistema (Pitfall 1 — eco)', () => {
    it('NÃO concede loopback quando o usuário desligou o áudio no seletor', async () => {
      const screen = fakeSource('screen:0:0', 'Tela 1')
      getSourcesMock.mockResolvedValue([screen])
      const { handler, window, emit } = await setup()

      const callback = vi.fn()
      const done = handler(AUDIO_REQUESTED, callback)
      await waitForPicker(window)
      emit(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, choice('screen:0:0', false))
      await done

      // `{ video }` sem a chave `audio` — não `{ video, audio: undefined }`,
      // e muito menos `audio: 'loopback'`. Este é o caminho DEFAULT do app.
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith({ video: screen })
    })

    it('NÃO concede loopback quando o renderer não pediu áudio, mesmo com o toggle ligado', async () => {
      const screen = fakeSource('screen:0:0', 'Tela 1')
      getSourcesMock.mockResolvedValue([screen])
      const { handler, window, emit } = await setup()

      const callback = vi.fn()
      const done = handler(AUDIO_NOT_REQUESTED, callback)
      await waitForPicker(window)
      emit(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, choice('screen:0:0', true))
      await done

      // O usuário ligou o toggle DENTRO do diálogo, com a captura já aberta
      // sem áudio. A escolha fica persistida para a próxima vez; conceder
      // loopback agora seria conceder uma captura que o renderer não vai
      // consumir. E o descompasso é avisado, nunca silencioso.
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith({ video: screen })
      expect(console.warn).toHaveBeenCalled()
    })

    it('trata systemAudio ausente ou não-booleano como desligado, sem cancelar', async () => {
      const screen = fakeSource('screen:0:0', 'Tela 1')
      getSourcesMock.mockResolvedValue([screen])

      for (const payload of [
        { sourceId: 'screen:0:0' },
        { sourceId: 'screen:0:0', systemAudio: 'true' },
        { sourceId: 'screen:0:0', systemAudio: 1 },
        { sourceId: 'screen:0:0', systemAudio: null }
      ]) {
        const { handler, window, emit } = await setup()
        const callback = vi.fn()
        const done = handler(AUDIO_REQUESTED, callback)
        await waitForPicker(window)
        emit(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, payload)
        await done

        // Payload malformado degrada para "sem som", nunca para "cancelou o
        // compartilhamento" e nunca para "ligou o loopback por acidente".
        expect(callback).toHaveBeenCalledTimes(1)
        expect(callback).toHaveBeenCalledWith({ video: screen })
      }
    })

    it('o caminho sem áudio também chama callback exatamente uma vez (Pitfall 2)', async () => {
      const screen = fakeSource('screen:0:0', 'Tela 1')
      getSourcesMock.mockResolvedValue([screen])
      const { handler, window, emit } = await setup()

      const callback = vi.fn()
      const done = handler(AUDIO_NOT_REQUESTED, callback)
      await waitForPicker(window)
      emit(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, choice('screen:0:0', false))
      emit(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, choice('screen:0:0', false))
      emit(SCREENSHARE_CHANNELS.CANCEL_PICKER)
      await done

      // O caminho novo herda a regra que governa o arquivo inteiro: um
      // `callback`, sempre, nem zero nem dois.
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith({ video: screen })
    })

    it('sem áudio numa tentativa não impede loopback na seguinte', async () => {
      const screen = fakeSource('screen:0:0', 'Tela 1')
      getSourcesMock.mockResolvedValue([screen])
      const { handler, window, emit } = await setup()

      const first = vi.fn()
      const firstDone = handler(AUDIO_REQUESTED, first)
      await waitForPicker(window)
      emit(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, choice('screen:0:0', false))
      await firstDone

      window.webContents.send.mockClear()
      const second = vi.fn()
      const secondDone = handler(AUDIO_REQUESTED, second)
      await waitForPicker(window)
      emit(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, choice('screen:0:0', true))
      await secondDone

      // A decisão é por compartilhamento, não pegajosa no processo main.
      expect(first).toHaveBeenCalledWith({ video: screen })
      expect(second).toHaveBeenCalledWith({ video: screen, audio: 'loopback' })
    })

    it('cancelar continua sendo callback({}) — não vira uma concessão sem áudio', async () => {
      getSourcesMock.mockResolvedValue([fakeSource('screen:0:0', 'Tela 1')])
      const { handler, window, emit } = await setup()

      const callback = vi.fn()
      const done = handler(AUDIO_NOT_REQUESTED, callback)
      await waitForPicker(window)
      emit(SCREENSHARE_CHANNELS.CANCEL_PICKER)
      await done

      // `{}` (cancelou) e `{ video }` (compartilhou sem som) são coisas
      // diferentes: a primeira rejeita o `getDisplayMedia`, a segunda publica.
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith({})
    })
  })

  describe('timeout defensivo', () => {
    it('cancela sozinho se ninguém responder, chamando callback({}) uma vez', async () => {
      vi.useFakeTimers()
      getSourcesMock.mockResolvedValue([fakeSource('screen:0:0', 'Tela 1')])
      const { handler } = await setup()

      const callback = vi.fn()
      const done = handler(AUDIO_REQUESTED, callback)

      // Antes do prazo: nada. Se o handler resolvesse cedo, o usuário perderia
      // o seletor no meio da escolha.
      await vi.advanceTimersByTimeAsync(PICKER_TIMEOUT_MS - 1)
      expect(callback).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(2)
      await done

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith({})
    })

    it('não dispara depois de o usuário já ter escolhido', async () => {
      vi.useFakeTimers()
      const screen = fakeSource('screen:0:0', 'Tela 1')
      getSourcesMock.mockResolvedValue([screen])
      const { handler, emit } = await setup()

      const callback = vi.fn()
      const done = handler(AUDIO_REQUESTED, callback)
      await vi.advanceTimersByTimeAsync(0)
      emit(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, choice('screen:0:0'))
      await done
      await vi.advanceTimersByTimeAsync(PICKER_TIMEOUT_MS * 2)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith({ video: screen, audio: 'loopback' })
    })
  })

  describe('tentativas sucessivas (base de SHARE-07)', () => {
    it('a tentativa seguinte a um cancelamento funciona normalmente', async () => {
      const screen = fakeSource('screen:0:0', 'Tela 1')
      getSourcesMock.mockResolvedValue([screen])
      const { handler, window, emit } = await setup()

      const first = vi.fn()
      const firstDone = handler(AUDIO_REQUESTED, first)
      await waitForPicker(window)
      emit(SCREENSHARE_CHANNELS.CANCEL_PICKER)
      await firstDone

      window.webContents.send.mockClear()
      const second = vi.fn()
      const secondDone = handler(AUDIO_REQUESTED, second)
      await waitForPicker(window)
      emit(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, choice('screen:0:0'))
      await secondDone

      // O sintoma que o Pitfall 2 descreve é justamente este: a primeira
      // tentativa "some" e todas as seguintes travam. Aqui a segunda conclui.
      expect(first).toHaveBeenCalledTimes(1)
      expect(first).toHaveBeenCalledWith({})
      expect(second).toHaveBeenCalledTimes(1)
      expect(second).toHaveBeenCalledWith({ video: screen, audio: 'loopback' })
    })

    it('um pedido novo cancela o anterior em vez de deixar dois pendentes', async () => {
      const screen = fakeSource('screen:0:0', 'Tela 1')
      getSourcesMock.mockResolvedValue([screen])
      const { handler, window, emit } = await setup()

      const first = vi.fn()
      const firstDone = handler(AUDIO_REQUESTED, first)
      await waitForPicker(window)

      window.webContents.send.mockClear()
      const second = vi.fn()
      const secondDone = handler(AUDIO_REQUESTED, second)
      await waitForPicker(window)

      // O primeiro já foi resolvido pela chegada do segundo — sem isso, ele
      // ficaria esperando uma resposta que agora pertence ao outro pedido.
      await firstDone
      expect(first).toHaveBeenCalledTimes(1)
      expect(first).toHaveBeenCalledWith({})

      emit(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, choice('screen:0:0'))
      await secondDone
      expect(second).toHaveBeenCalledTimes(1)
      expect(second).toHaveBeenCalledWith({ video: screen, audio: 'loopback' })
      expect(first).toHaveBeenCalledTimes(1)
    })
  })

  describe('registro', () => {
    it('registra o handler e os listeners de IPC uma única vez, mesmo se chamada de novo', async () => {
      vi.resetModules()
      const { registerScreenShareHandler } = await import('./screenshare')

      registerScreenShareHandler(() => null)
      registerScreenShareHandler(() => null)

      // Registrar de novo SUBSTITUIRIA o handler de captura silenciosamente, e
      // EMPILHARIA um segundo par de listeners de IPC — dois listeners
      // resolvendo a mesma escolha.
      expect(setDisplayMediaRequestHandlerMock).toHaveBeenCalledTimes(1)
      expect(
        ipcMainOnMock.mock.calls.filter((c) => c[0] === SCREENSHARE_CHANNELS.CHOOSE_SOURCE)
      ).toHaveLength(1)
      expect(
        ipcMainOnMock.mock.calls.filter((c) => c[0] === SCREENSHARE_CHANNELS.CANCEL_PICKER)
      ).toHaveLength(1)
      expect(console.warn).toHaveBeenCalled()
    })

    it('registra exatamente um listener por canal do seletor', async () => {
      const { listenerCount } = await setup()

      expect(listenerCount(SCREENSHARE_CHANNELS.CHOOSE_SOURCE)).toBe(1)
      expect(listenerCount(SCREENSHARE_CHANNELS.CANCEL_PICKER)).toBe(1)
    })
  })
})
