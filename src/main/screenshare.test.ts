// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Pitfall 2 (PITFALLS.md) é a razão deste arquivo existir: um handler de
// `setDisplayMediaRequestHandler` que termina sem chamar `callback` deixa a
// Promise de `getDisplayMedia()` pendurada para sempre no renderer — a UI
// fica carregando e TODA tentativa seguinte de compartilhar na mesma sessão
// trava junto. É um defeito silencioso (nenhum erro, nenhum log) e só
// aparece no caminho de exceção, que é justamente o que nunca acontece na
// verificação manual feliz. Aqui os três caminhos do handler são forçados e
// se cobra exatamente UMA chamada a `callback` em cada um.
//
// Não é substituto do checkpoint humano do Plano 08-03: isto prova o
// contrato do handler, não que a captura funciona (WSL2 não tem tela nem
// áudio, e `desktopCapturer` real nunca roda aqui).

const { getSourcesMock, setDisplayMediaRequestHandlerMock } = vi.hoisted(() => ({
  getSourcesMock: vi.fn(),
  setDisplayMediaRequestHandlerMock: vi.fn()
}))

vi.mock('electron', () => ({
  desktopCapturer: { getSources: getSourcesMock },
  session: {
    defaultSession: { setDisplayMediaRequestHandler: setDisplayMediaRequestHandlerMock }
  }
}))

type Streams = { video?: { id: string; name: string }; audio?: string }
type DisplayMediaHandler = (request: unknown, callback: (streams: Streams) => void) => unknown

/**
 * Carrega o módulo do zero (o guarda de registro único é estado de módulo) e
 * devolve o handler que ele registrou.
 */
async function registerAndGetHandler(): Promise<DisplayMediaHandler> {
  vi.resetModules()
  const { registerScreenShareHandler } = await import('./screenshare')
  registerScreenShareHandler()
  const lastCall = setDisplayMediaRequestHandlerMock.mock.calls.at(-1)
  if (!lastCall) throw new Error('setDisplayMediaRequestHandler não foi chamado')
  return lastCall[0] as DisplayMediaHandler
}

describe('registerScreenShareHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('concede a primeira tela com áudio de sistema (loopback), chamando callback uma vez', async () => {
    const screen = { id: 'screen:0:0', name: 'Tela 1' }
    getSourcesMock.mockResolvedValue([screen, { id: 'screen:1:0', name: 'Tela 2' }])
    const handler = await registerAndGetHandler()

    const callback = vi.fn()
    await handler({}, callback)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({ video: screen, audio: 'loopback' })
  })

  it('pede só fontes do tipo screen (janela é o Plano 08-04)', async () => {
    getSourcesMock.mockResolvedValue([{ id: 'screen:0:0', name: 'Tela 1' }])
    const handler = await registerAndGetHandler()

    await handler({}, vi.fn())

    expect(getSourcesMock).toHaveBeenCalledWith(expect.objectContaining({ types: ['screen'] }))
  })

  it('chama callback({}) quando não há nenhuma tela disponível', async () => {
    getSourcesMock.mockResolvedValue([])
    const handler = await registerAndGetHandler()

    const callback = vi.fn()
    await handler({}, callback)

    // `{}` é o cancelamento explícito documentado; `{ video: undefined }`
    // não é a mesma coisa e é exatamente o erro que o Pitfall 2 descreve.
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({})
  })

  it('chama callback({}) quando desktopCapturer.getSources rejeita', async () => {
    getSourcesMock.mockRejectedValue(new Error('captura indisponível'))
    const handler = await registerAndGetHandler()

    const callback = vi.fn()
    await handler({}, callback)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({})
  })

  it('não deixa a exceção de getSources escapar do handler', async () => {
    getSourcesMock.mockRejectedValue(new Error('captura indisponível'))
    const handler = await registerAndGetHandler()

    // Se a rejeição escapasse, isto viraria unhandled rejection no processo
    // main — que é o outro sintoma descrito no Pitfall 2.
    await expect(handler({}, vi.fn())).resolves.not.toThrow()
  })

  it('registra o handler uma única vez, mesmo se chamada de novo', async () => {
    vi.resetModules()
    const { registerScreenShareHandler } = await import('./screenshare')

    registerScreenShareHandler()
    registerScreenShareHandler()

    // Registrar de novo SUBSTITUIRIA o handler anterior silenciosamente.
    expect(setDisplayMediaRequestHandlerMock).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalled()
  })
})
