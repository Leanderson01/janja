// @vitest-environment jsdom
import '@/test/jsdom-setup'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { TooltipProvider } from '@/components/ui/tooltip'

import { ServerMenu } from './ChannelSidebar'
import { ServerRailIcon } from './ServerRail'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function iconProps(over: Partial<Parameters<typeof ServerRailIcon>[0]> = {}) {
  return {
    name: 'janja da galera',
    iconUrl: null,
    isActive: false,
    inVoice: false,
    onSelect: vi.fn(),
    ...over
  }
}

function renderIcon(over: Partial<Parameters<typeof ServerRailIcon>[0]> = {}) {
  return render(
    <TooltipProvider>
      <ServerRailIcon {...iconProps(over)} />
    </TooltipProvider>
  )
}

function renderIconWithMenu() {
  return render(
    <TooltipProvider>
      <ServerMenu serverName="janja da galera" onInvite={vi.fn()} onCreateChannel={vi.fn()}>
        <ServerRailIcon {...iconProps()} />
      </ServerMenu>
    </TooltipProvider>
  )
}

describe('ServerRailIcon', () => {
  it('servidor aberto tem a pílula de 40px', () => {
    renderIcon({ isActive: true })
    expect(screen.getByTestId('rail-pill').getAttribute('data-state')).toBe('active')
  })
  it('sem servidor aberto a pílula fica escondida', () => {
    renderIcon({ isActive: false })
    expect(screen.getByTestId('rail-pill').getAttribute('data-state')).toBe('idle')
  })
  it('mostra o alto-falante quando você está em call nele', () => {
    renderIcon({ inVoice: true })
    expect(screen.getByLabelText('Você está em call neste servidor')).toBeTruthy()
  })
  it('ícone é quadrado de cantos arredondados, sem anel', () => {
    const { container } = renderIcon({ isActive: true })
    const av = container.querySelector('[data-slot="avatar"]')!
    expect(av.className).toContain('rounded-xl')
    expect(av.className).not.toContain('ring-')
  })
  it('clique direito no ícone abre o menu do servidor', () => {
    renderIconWithMenu()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'janja da galera' }))
    expect(screen.getByRole('menuitem', { name: 'Convidar pessoas' })).toBeTruthy()
  })
})
