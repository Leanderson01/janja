// @vitest-environment jsdom
import '@/test/jsdom-setup'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { TooltipProvider } from '@/components/ui/tooltip'
import { SelfIdentityView } from '@/features/auth/UserPanel'

import { VoiceButtonsView } from './VoiceControlBar'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderButtons(props: { muted?: boolean; deafened?: boolean }): void {
  render(
    <TooltipProvider>
      <VoiceButtonsView
        muted={props.muted ?? false}
        deafened={props.deafened ?? false}
        onToggleMute={vi.fn()}
        onToggleDeafen={vi.fn()}
        inputMenu={<button type="button" aria-label="Dispositivo de entrada" />}
        outputMenu={<button type="button" aria-label="Dispositivo de saída" />}
      />
    </TooltipProvider>
  )
}

describe('VoiceButtonsView', () => {
  it('mic mutado mostra o ícone cortado e o rótulo de reativar', () => {
    renderButtons({ muted: true })
    const b = screen.getByRole('button', { name: 'Ativar microfone' })
    expect(b.getAttribute('aria-pressed')).toBe('true')
  })
  it('os botões nunca ficam desabilitados', () => {
    renderButtons({})
    for (const name of ['Desativar microfone', 'Ensurdecer']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false)
    }
  })
  it('ensurdecido mostra o fone cortado', () => {
    renderButtons({ deafened: true, muted: true })
    expect(screen.getByRole('button', { name: 'Desensurdecer' })).toBeTruthy()
  })
})

describe('SelfIdentityView', () => {
  it('mostra Online e troca para o @usuário no hover', () => {
    render(<SelfIdentityView userId="u1" displayName="Leo" username="leo" />)
    expect(screen.getByText('Online')).toBeTruthy()
    expect(screen.getByText('@leo').className).toContain('group-hover:inline')
  })
})
