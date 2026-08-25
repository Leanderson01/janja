// @vitest-environment jsdom
import '@/test/jsdom-setup'

import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ScreenSharePicker } from './ScreenSharePicker'
import {
  loadScreenSharePreferences,
  saveScreenSharePreferences
} from '@/lib/screenshare-preferences'

// O módulo real, embrulhado em `vi.fn`: a persistência continua acontecendo
// de verdade (os testes de preferência abaixo dependem disso), e ainda dá
// para afirmar o negativo que importa — que um toggle desabilitado não
// ESCREVE nada. Sem isto, "não mudou" e "mudou e voltou" seriam
// indistinguíveis.
vi.mock('@/lib/screenshare-preferences', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/screenshare-preferences')>()
  return { ...actual, saveScreenSharePreferences: vi.fn(actual.saveScreenSharePreferences) }
})

// ------------------------------------------------------------------
// A metade do renderer da correção do Pitfall 1 (eco do áudio da call,
// relatado com 4 pessoas numa call em 2026-08-20), reescrita na Fase 8.6
// quando o áudio virou loopback POR PROCESSO em modo EXCLUIR.
//
// O que este arquivo prova, sem Windows, sem tela e sem placa de som: que a
// decisão sobre o áudio de sistema SAI daqui com o valor certo e chega ao
// processo main junto da fonte, e que a tela DIZ o que vai acontecer — as
// duas coisas verificáveis em WSL2. Que a voz das outras pessoas de fato
// fique de fora, só a máquina do Leo com 3+ pessoas numa call pode dizer
// (item nº 1 do checkpoint 08.6-06). Um teste de texto prova que a FRASE
// está na tela, nunca que ela é verdade — e é por isso que a frase é testada
// literalmente: se ela for falsa lá, este é o primeiro arquivo a mudar.
//
// A outra regra que este arquivo protege é a antiga (Pitfall 2): o diálogo
// nunca pode fechar sem chamar `chooseSource` OU `cancelPicker`, senão o
// `getDisplayMedia()` que o processo main está segurando fica pendurado para
// sempre e todo compartilhamento seguinte trava junto.
//
// Receita do Plano 08.5-02: docblock de ambiente na 1ª linha, `jsdom-setup` na
// 2ª, `cleanup()` obrigatório no afterEach (o vitest aqui não roda com
// `globals: true`). `@testing-library/jest-dom` NÃO está instalado — asserções
// em DOM puro.
// ------------------------------------------------------------------

type PickListener = (data: ScreenSharePickRequest) => void

const chooseSource = vi.fn()
const cancelPicker = vi.fn()
let listener: PickListener | null = null

function installScreenshareBridge(): void {
  ;(window as unknown as { screenshare: unknown }).screenshare = {
    onPickRequested: (callback: PickListener): (() => void) => {
      listener = callback
      return () => {
        listener = null
      }
    },
    chooseSource,
    cancelPicker
  }
}

const SOURCES: ScreenShareSource[] = [
  {
    id: 'screen:0:0',
    name: 'Tela inteira',
    thumbnailDataUrl: 'data:image/png;base64,tela',
    isScreen: true
  },
  {
    id: 'window:42:0',
    name: 'Navegador',
    thumbnailDataUrl: 'data:image/png;base64,janela',
    isScreen: false
  }
]

/**
 * Dispara o `pick-requested` como o processo main faria.
 *
 * `audioAvailable` MUDOU DE SIGNIFICADO na Fase 8.6: era "o renderer pediu
 * áudio nesta chamada de `getDisplayMedia()`", agora é "esta máquina suporta
 * áudio por processo" (`isProcessAudioSupported()`). O `audioUnavailableReason`
 * é opcional no contrato — daí ele ser opcional aqui, e daí existir um teste
 * para a ausência dele.
 */
function openPicker(
  audioAvailable = true,
  audioUnavailableReason?: ScreenShareAudioUnavailableReason
): void {
  act(() => {
    listener?.({ sources: SOURCES, audioAvailable, audioUnavailableReason } as never)
  })
}

function toggle(): HTMLButtonElement {
  return screen.getByRole('button', {
    name: /ligado|desligado|indisponível/i
  }) as HTMLButtonElement
}

beforeEach(() => {
  localStorage.clear()
  installScreenshareBridge()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  listener = null
  delete (window as unknown as { screenshare?: unknown }).screenshare
})

describe('ScreenSharePicker — áudio de sistema (Pitfall 1)', () => {
  it('abre com o áudio DESLIGADO quando nunca foi configurado', () => {
    render(<ScreenSharePicker />)
    openPicker()

    // O default honesto enquanto o eco não estiver provado resolvido: melhor
    // tela sem som que quatro pessoas se ouvindo.
    expect(toggle().textContent).toBe('Desligado')
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
  })

  it('manda systemAudio: false junto com a fonte escolhida', async () => {
    const user = userEvent.setup()
    render(<ScreenSharePicker />)
    openPicker()

    await user.click(screen.getByRole('button', { name: /Tela inteira/ }))

    // A fonte E a decisão sobre o áudio, num payload só: é o processo main
    // que concede o loopback, e sem este `false` ele concederia sempre.
    expect(chooseSource).toHaveBeenCalledTimes(1)
    expect(chooseSource).toHaveBeenCalledWith({ sourceId: 'screen:0:0', systemAudio: false })
  })

  it('manda systemAudio: true depois de o usuário ligar o toggle', async () => {
    const user = userEvent.setup()
    render(<ScreenSharePicker />)
    openPicker()

    await user.click(toggle())
    expect(toggle().textContent).toBe('Ligado')

    await user.click(screen.getByRole('button', { name: /Navegador/ }))
    expect(chooseSource).toHaveBeenCalledWith({ sourceId: 'window:42:0', systemAudio: true })
  })

  it('persiste a escolha como preferência de máquina', async () => {
    const user = userEvent.setup()
    render(<ScreenSharePicker />)
    openPicker()

    await user.click(toggle())

    // Quem sempre compartilha com som marca uma vez, não toda vez.
    expect(loadScreenSharePreferences().systemAudio).toBe(true)
  })

  it('relê a preferência a cada abertura, não só no mount', () => {
    render(<ScreenSharePicker />)
    openPicker()
    expect(toggle().textContent).toBe('Desligado')

    act(() => {
      screen.getByRole('button', { name: 'Cancelar' }).click()
    })

    // Simula a preferência tendo mudado por fora (configurações de voz, outra
    // janela) entre uma abertura e a seguinte. Um estado inicial preso no
    // mount mostraria o toggle mentindo sobre o que vai acontecer.
    saveScreenSharePreferences({ systemAudio: true })
    openPicker()
    expect(toggle().textContent).toBe('Ligado')
  })

  it('numa máquina que suporta, o toggle é clicável e alterna Ligado/Desligado', async () => {
    const user = userEvent.setup()
    render(<ScreenSharePicker />)
    openPicker(true)

    expect(toggle().disabled).toBe(false)
    await user.click(toggle())
    expect(toggle().textContent).toBe('Ligado')
    await user.click(toggle())
    expect(toggle().textContent).toBe('Desligado')
  })

  it('promete, com todas as letras, que a voz das outras pessoas fica de fora', async () => {
    const user = userEvent.setup()
    render(<ScreenSharePicker />)
    openPicker()

    await user.click(toggle())

    // TESTE DE TEXTO DE PROPÓSITO. Esta frase é a promessa central da Fase
    // 8.6 e um compromisso de produto: mudá-la sem querer tem que quebrar
    // alguma coisa. Se o checkpoint 08.6-06 provar que ela é FALSA, é este
    // teste que precisa cair junto com o texto — não o contrário.
    expect(screen.getByText(/a voz das outras pessoas da call fica de fora/i)).toBeTruthy()
    // E o preço, na mesma tela: não é o áudio "da janela", é o computador.
    expect(screen.getByText(/tudo que o computador estiver tocando/i)).toBeTruthy()
    expect(screen.getByText(/música, vídeos de outras abas e sons de notificação/i)).toBeTruthy()
  })

  it('o aviso obsoleto do "próximo compartilhamento" não existe mais em lugar nenhum', async () => {
    const user = userEvent.setup()
    render(<ScreenSharePicker />)
    openPicker(true)

    // A captura de áudio agora começa DEPOIS que o seletor fecha, relendo a
    // preferência: ligar vale para ESTA transmissão. O aviso antigo virou
    // mentira na direção contrária — assustar quem deveria usar.
    await user.click(toggle())
    expect(screen.queryByText(/próximo compartilhamento/i)).toBe(null)
    expect(screen.queryByText(/vão se ouvir de volta/i)).toBe(null)
  })
})

describe('ScreenSharePicker — máquina sem áudio por processo (Fase 8.6)', () => {
  it('o toggle aparece desabilitado, com rótulo próprio, em vez de sumir', () => {
    render(<ScreenSharePicker />)
    openPicker(false, 'windows-too-old')

    // Sumir seria esconder que existe o recurso; ficar clicável seria fingir
    // que ele funciona. Desabilitado com motivo é a única opção honesta.
    expect(toggle().textContent).toBe('Indisponível')
    expect(toggle().disabled).toBe(true)
    expect(toggle().getAttribute('aria-disabled')).toBe('true')
    // Deixou de ser um interruptor de dois estados: não anuncia estado.
    expect(toggle().getAttribute('aria-pressed')).toBe(null)
  })

  it('clicar no toggle desabilitado não persiste nada', async () => {
    const user = userEvent.setup()
    // A pessoa já tinha ligado o áudio em outra máquina (preferência de
    // máquina, mas o cenário vale para qualquer origem do `true`).
    saveScreenSharePreferences({ systemAudio: true })
    vi.mocked(saveScreenSharePreferences).mockClear()

    render(<ScreenSharePicker />)
    openPicker(false, 'not-windows')

    await user.click(toggle())

    expect(vi.mocked(saveScreenSharePreferences)).not.toHaveBeenCalled()
    // A escolha continua lá, intacta: se ela voltar para o computador que
    // suporta, não precisa marcar de novo.
    expect(loadScreenSharePreferences().systemAudio).toBe(true)
  })

  it('não manda systemAudio: true de uma máquina que não suporta', async () => {
    const user = userEvent.setup()
    saveScreenSharePreferences({ systemAudio: true })

    render(<ScreenSharePicker />)
    openPicker(false, 'windows-too-old')

    await user.click(screen.getByRole('button', { name: /Tela inteira/ }))

    // Pedir áudio aqui só poderia ser atendido pelo caminho VELHO (loopback
    // de dispositivo), que é o que devolve o eco de 2026-08-20.
    expect(chooseSource).toHaveBeenCalledTimes(1)
    expect(chooseSource).toHaveBeenCalledWith({ sourceId: 'screen:0:0', systemAudio: false })
    // E sem apagar a preferência salva.
    expect(loadScreenSharePreferences().systemAudio).toBe(true)
  })

  it.each([
    [
      'windows-too-old' as const,
      /Seu Windows não tem suporte a áudio por aplicativo\. Ele existe a partir do Windows 11\./
    ],
    ['not-windows' as const, /Áudio de compartilhamento só funciona no Windows\./],
    [
      'addon-unavailable' as const,
      /Não foi possível iniciar o áudio de compartilhamento nesta instalação\./
    ],
    [
      'start-failed' as const,
      /Não foi possível iniciar o áudio de compartilhamento nesta instalação\./
    ]
  ])('explica o motivo %s em português', (reason, expected) => {
    render(<ScreenSharePicker />)
    openPicker(false, reason)

    // A limitação é da MÁQUINA da pessoa, e ela merece saber disso em vez de
    // achar que o app quebrou. `start-failed` cai no genérico de propósito:
    // o que o distingue é um HRESULT, que serve ao log, não à tela.
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it('sem motivo nenhum, cai no texto genérico em vez de quebrar', () => {
    render(<ScreenSharePicker />)
    // O campo é opcional no contrato: um main mais velho, ou uma falha que
    // não soube se classificar, chega assim.
    openPicker(false, undefined)

    expect(screen.getByText(/Não foi possível iniciar o áudio de compartilhamento/i)).toBeTruthy()
    expect(toggle().disabled).toBe(true)
  })

  it('o motivo está amarrado ao botão por aria-describedby, não só por proximidade', () => {
    render(<ScreenSharePicker />)
    openPicker(false, 'not-windows')

    const describedBy = toggle().getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const reasonNode = document.getElementById(describedBy as string)
    expect(reasonNode?.textContent).toBe('Áudio de compartilhamento só funciona no Windows.')
  })

  it('numa máquina que suporta, nada de indisponibilidade aparece', () => {
    render(<ScreenSharePicker />)
    openPicker(true)

    expect(toggle().disabled).toBe(false)
    expect(toggle().getAttribute('aria-describedby')).toBe(null)
    expect(screen.queryByText(/só funciona no Windows/i)).toBe(null)
    expect(screen.queryByText(/Não foi possível iniciar o áudio/i)).toBe(null)
  })
})

describe('ScreenSharePicker — contrato do Pitfall 2 (nada pendurado)', () => {
  it('o botão Cancelar destrava o processo main', async () => {
    const user = userEvent.setup()
    render(<ScreenSharePicker />)
    openPicker()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(cancelPicker).toHaveBeenCalledTimes(1)
    expect(chooseSource).not.toHaveBeenCalled()
  })

  it('Esc destrava o processo main', async () => {
    const user = userEvent.setup()
    render(<ScreenSharePicker />)
    openPicker()

    await user.keyboard('{Escape}')
    expect(cancelPicker).toHaveBeenCalledTimes(1)
  })

  it('escolher com o áudio ligado manda o systemAudio ATUAL, uma vez só', async () => {
    const user = userEvent.setup()
    render(<ScreenSharePicker />)
    openPicker(true)

    await user.click(toggle())
    await user.click(screen.getByRole('button', { name: /Tela inteira/ }))

    // O contrato do Pitfall 2 não regride quando o bloco do áudio muda:
    // exatamente UMA resposta ao processo main, carregando a decisão.
    expect(chooseSource).toHaveBeenCalledTimes(1)
    expect(chooseSource).toHaveBeenCalledWith({ sourceId: 'screen:0:0', systemAudio: true })
    expect(cancelPicker).not.toHaveBeenCalled()
  })

  it('escolher uma fonte NÃO dispara um cancelamento em seguida', async () => {
    const user = userEvent.setup()
    render(<ScreenSharePicker />)
    openPicker()

    await user.click(screen.getByRole('button', { name: /Tela inteira/ }))
    expect(chooseSource).toHaveBeenCalledTimes(1)
    expect(cancelPicker).not.toHaveBeenCalled()
  })

  it('mexer no toggle não fecha o diálogo nem responde ao processo main', async () => {
    const user = userEvent.setup()
    render(<ScreenSharePicker />)
    openPicker()

    await user.click(toggle())
    await user.click(toggle())

    // O toggle é um controle, não uma resposta: enquanto ele é usado, o
    // `getDisplayMedia()` continua legitimamente pendurado esperando a fonte.
    expect(chooseSource).not.toHaveBeenCalled()
    expect(cancelPicker).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
