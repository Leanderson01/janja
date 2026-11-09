// @vitest-environment jsdom
import '@/test/jsdom-setup'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TitleBarView } from './TitleBar'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderBar(over: Partial<React.ComponentProps<typeof TitleBarView>> = {}) {
  return render(
    <TooltipProvider>
      <TitleBarView
        title="Hydra"
        canGoBack={false}
        canGoForward={false}
        onBack={vi.fn()}
        onForward={vi.fn()}
        reserveWindowControls={false}
        {...over}
      />
    </TooltipProvider>
  )
}

describe('TitleBarView', () => {
  it('mostra o título no centro', () => {
    renderBar({ title: 'janja da galera' })
    expect(screen.getByText('janja da galera')).toBeTruthy()
  })
  it('Voltar fica desabilitado sem histórico', () => {
    renderBar({ canGoBack: false })
    expect((screen.getByRole('button', { name: 'Voltar' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('Avançar chama o handler', async () => {
    const onForward = vi.fn()
    renderBar({ canGoForward: true, onForward })
    await userEvent.click(screen.getByRole('button', { name: 'Avançar' }))
    expect(onForward).toHaveBeenCalledOnce()
  })
  it('reserva espaço para os botões da janela', () => {
    const { container } = renderBar({ reserveWindowControls: true })
    expect(container.querySelector('[data-window-controls-reserve]')).toBeTruthy()
  })
  it('não reserva espaço quando a janela não tem botões nativos', () => {
    const { container } = renderBar({ reserveWindowControls: false })
    expect(container.querySelector('[data-window-controls-reserve]')).toBeNull()
  })
})
