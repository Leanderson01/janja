// @vitest-environment jsdom
import '@/test/jsdom-setup'

import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { AVATAR_TILE_BG, avatarColorIndex } from '@/lib/avatar-color'

import { CallControlsView, useIdle } from './CallControls'
import { ParticipantTile } from './ParticipantTile'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

function renderControls(
  over: Partial<React.ComponentProps<typeof CallControlsView>> = {}
): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <CallControlsView
        visible
        isSharing={false}
        canShare
        muted={false}
        deafened={false}
        onToggleShare={vi.fn()}
        onToggleMute={vi.fn()}
        onToggleDeafen={vi.fn()}
        onLeave={vi.fn()}
        onFullscreen={vi.fn()}
        inputMenu={<span />}
        outputMenu={<span />}
        {...over}
      />
    </TooltipProvider>
  )
}

describe('ParticipantTile', () => {
  it('bloco de quem fala tem a borda verde', () => {
    const { container } = render(<ParticipantTile userId="u1" name="Leo" muted={false} speaking />)
    expect(container.firstElementChild!.getAttribute('data-speaking')).toBe('true')
  })
  it('bloco mutado mostra o mic cortado ao lado do nome', () => {
    render(<ParticipantTile userId="u1" name="Gordão" muted speaking={false} />)
    expect(screen.getByLabelText('Mutado')).toBeTruthy()
  })
  it('fundo do bloco vem da cor do id', () => {
    const { container } = render(
      <ParticipantTile userId="u1" name="Leo" muted={false} speaking={false} />
    )
    expect(container.firstElementChild!.className).toContain(AVATAR_TILE_BG[avatarColorIndex('u1')])
  })
  it('clique direito chama o handler', () => {
    const onContextMenu = vi.fn()
    const { container } = render(
      <ParticipantTile
        userId="u1"
        name="Leo"
        muted={false}
        speaking={false}
        onContextMenu={onContextMenu}
      />
    )
    fireEvent.contextMenu(container.firstElementChild!)
    expect(onContextMenu).toHaveBeenCalledOnce()
  })
})

describe('CallControlsView', () => {
  it('sair chama o handler e mutado aparece pressionado', async () => {
    const onLeave = vi.fn()
    renderControls({ muted: true, onLeave })
    expect(
      screen.getByRole('button', { name: 'Ativar microfone' }).getAttribute('aria-pressed')
    ).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: 'Sair da call' }))
    expect(onLeave).toHaveBeenCalledOnce()
  })
  it('controles escondidos ficam inertes', () => {
    const { container } = renderControls({ visible: false })
    expect(container.firstElementChild!.getAttribute('data-visible')).toBe('false')
  })
})

describe('useIdle', () => {
  it('fica ocioso após o tempo e volta ao mexer o mouse', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useIdle(3000))
    expect(result.current.idle).toBe(false)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.idle).toBe(true)
    act(() => result.current.bind.onMouseMove())
    expect(result.current.idle).toBe(false)
  })
})
