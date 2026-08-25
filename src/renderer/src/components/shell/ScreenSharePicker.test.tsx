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

// ------------------------------------------------------------------
// A metade do renderer da correção do Pitfall 1 (eco do áudio da call,
// relatado com 4 pessoas numa call em 2026-08-20).
//
// O que este arquivo prova, sem Windows, sem tela e sem placa de som: que a
// decisão sobre o áudio de sistema SAI daqui com o valor certo e chega ao
// processo main junto da fonte. É a única metade verificável em WSL2 — que o
// loopback do WASAPI de fato não é capturado só a máquina do Leo pode dizer.
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

/** Dispara o `pick-requested` como o processo main faria. */
function openPicker(audioAvailable = true): void {
  act(() => {
    listener?.({ sources: SOURCES, audioAvailable })
  })
}

function toggle(): HTMLElement {
  return screen.getByRole('button', { name: /ligado|desligado/i })
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

  it('avisa quando ligar o áudio só vai valer no próximo compartilhamento', async () => {
    const user = userEvent.setup()
    render(<ScreenSharePicker />)
    // `audioAvailable: false` = o renderer abriu esta captura sem pedir áudio,
    // e a constraint do `getDisplayMedia()` não dá para renegociar com o
    // diálogo já aberto.
    openPicker(false)

    expect(screen.queryByText(/vale a partir do próximo/i)).toBe(null)
    await user.click(toggle())
    expect(screen.getByText(/vale a partir do próximo/i)).toBeTruthy()
  })

  it('não avisa nada quando o áudio foi pedido e pode ser concedido agora', async () => {
    const user = userEvent.setup()
    render(<ScreenSharePicker />)
    openPicker(true)

    await user.click(toggle())
    expect(screen.queryByText(/vale a partir do próximo/i)).toBe(null)
  })

  it('explica o eco quando o áudio está ligado', async () => {
    const user = userEvent.setup()
    render(<ScreenSharePicker />)
    openPicker()

    await user.click(toggle())
    // O aviso é o defeito real escrito em português de gente, não disclaimer.
    expect(screen.getByText(/elas vão se ouvir de volta/i)).toBeTruthy()
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
