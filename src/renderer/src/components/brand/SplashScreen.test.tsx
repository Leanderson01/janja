// @vitest-environment jsdom
import '@/test/jsdom-setup'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SplashScreen } from './SplashScreen'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
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
