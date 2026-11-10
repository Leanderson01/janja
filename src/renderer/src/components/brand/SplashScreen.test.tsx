// @vitest-environment jsdom
import '@/test/jsdom-setup'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
const caps = vi.hoisted(() => ({ nativeWindowControls: true }))
vi.mock('@platform/capabilities', () => ({ capabilities: caps }))

import { SplashScreen } from './SplashScreen'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SplashScreen — faixa de arrastar', () => {
  it('mostra a faixa arrastável quando a janela é nativa', () => {
    caps.nativeWindowControls = true
    const { container } = render(<SplashScreen message="Carregando…" />)
    const strip = container.querySelector('[data-testid="window-drag-strip"]')
    expect(strip).not.toBeNull()
    expect(strip?.className).toContain('[app-region:drag]')
  })

  it('não mostra a faixa quando a janela não é nativa (web)', () => {
    caps.nativeWindowControls = false
    const { container } = render(<SplashScreen message="Carregando…" />)
    expect(container.querySelector('[data-testid="window-drag-strip"]')).toBeNull()
  })
})

describe('SplashScreen', () => {
  it('mostra a estrela e a mensagem', () => {
    render(<SplashScreen message="Carregando…" />)
    expect(screen.getByRole('img', { name: 'Hydra' })).toBeTruthy()
    expect(screen.getByText('Carregando…')).toBeTruthy()
  })

  it('mostra as ações opcionais embaixo da mensagem', () => {
    render(
      <SplashScreen message="Erro">
        <button type="button">Recarregar</button>
      </SplashScreen>
    )
    expect(screen.getByRole('button', { name: 'Recarregar' })).toBeTruthy()
  })
})
