// @vitest-environment jsdom
import '@/test/jsdom-setup'

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { AVATAR_TILE_BG, avatarColorIndex } from '@/lib/avatar-color'

import { PortalContainerProvider } from '@/components/ui/portal-container'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useIdle } from '@/hooks/use-idle'

import { shouldShowCallControls } from '@/lib/call-grid'

import { CallControlsView } from './CallControls'
import { ParticipantAudioContextMenu } from './ParticipantAudioMenu'
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

describe('CallControlsView — tela cheia e posição', () => {
  it('rótulo do botão é "Tela cheia" fora da tela cheia', () => {
    renderControls()
    expect(screen.getByRole('button', { name: 'Tela cheia' })).toBeTruthy()
  })
  it('rótulo vira "Sair da tela cheia" em tela cheia', () => {
    renderControls({ isFullscreen: true })
    expect(screen.getByRole('button', { name: 'Sair da tela cheia' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Tela cheia' })).toBeNull()
  })
  it('no layout com faixa a barra sobe acima da faixa de participantes', () => {
    const { container } = renderControls({ aboveStrip: true })
    const root = container.querySelector('[data-visible]')!
    expect(root.className).toContain('bottom-[6.5rem]')
    expect(root.className).not.toContain('bottom-6')
  })
  it('sem faixa a barra fica em bottom-6', () => {
    const { container } = renderControls()
    expect(container.querySelector('[data-visible]')!.className).toContain('bottom-6')
  })
})

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
  it('bloco ao vivo mostra AO VIVO e Assistir transmissão', async () => {
    const onWatch = vi.fn()
    render(
      <ParticipantTile
        userId="u1"
        name="VM"
        muted={false}
        speaking={false}
        live={{ watching: false, onWatch }}
      />
    )
    expect(screen.getByText('AO VIVO')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Assistir transmissão' }))
    expect(onWatch).toHaveBeenCalledOnce()
  })
  it('assistindo, o bloco continua AO VIVO e o clique volta para a transmissão', async () => {
    const onWatch = vi.fn()
    render(
      <ParticipantTile
        userId="u1"
        name="VM"
        muted={false}
        speaking={false}
        live={{ watching: true, onWatch }}
      />
    )
    expect(screen.getByText('AO VIVO')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Assistir transmissão' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Ver transmissão' }))
    expect(onWatch).toHaveBeenCalledOnce()
  })
  it('bloco sem transmissão não tem AO VIVO nem botão', () => {
    render(<ParticipantTile userId="u1" name="VM" muted={false} speaking={false} />)
    expect(screen.queryByText('AO VIVO')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('clique direito no bloco ao vivo chega ao handler do menu de áudio', () => {
    const onContextMenu = vi.fn()
    render(
      <ParticipantTile
        userId="u1"
        name="VM"
        muted={false}
        speaking={false}
        onContextMenu={onContextMenu}
        live={{ watching: false, onWatch: vi.fn() }}
      />
    )
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Assistir transmissão' }))
    expect(onContextMenu).toHaveBeenCalledOnce()
  })
})

describe('ParticipantAudioContextMenu', () => {
  it('ao fechar, devolve o foco ao botão do bloco ao vivo', async () => {
    function Harness(): React.JSX.Element {
      const buttonRef = useRef<HTMLButtonElement>(null)
      const [open, setOpen] = useState(false)
      return (
        <div className="relative" onContextMenu={() => setOpen(true)}>
          <ParticipantTile
            userId="u1"
            name="VM"
            muted={false}
            speaking={false}
            live={{ watching: false, onWatch: vi.fn() }}
            liveButtonRef={buttonRef}
          />
          <ParticipantAudioContextMenu
            open={open}
            onOpenChange={setOpen}
            focusRef={buttonRef}
            username="VM"
            preference={undefined}
            onVolumeChange={vi.fn()}
            onToggleSilenced={vi.fn()}
          />
        </div>
      )
    }
    render(<Harness />)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Assistir transmissão' }))
    expect(await screen.findByRole('menu')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Assistir transmissão' })
    )
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

describe('barra de controles', () => {
  it('compartilhar desabilitado fica desabilitado', () => {
    renderControls({ canShare: false })
    expect(
      (screen.getByRole('button', { name: 'Compartilhar tela' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })
  it('só aparece no canal em que estou conectado', () => {
    expect(shouldShowCallControls({ channelId: 'a', joinedVoiceChannelId: 'a' })).toBe(true)
    expect(shouldShowCallControls({ channelId: 'a', joinedVoiceChannelId: 'b' })).toBe(false)
    expect(shouldShowCallControls({ channelId: 'a', joinedVoiceChannelId: null })).toBe(false)
  })
})

describe('PortalContainerProvider', () => {
  it('menu monta dentro do elemento fornecido (tela cheia)', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    render(
      <PortalContainerProvider value={container}>
        <DropdownMenu>
          <DropdownMenuTrigger>abrir</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PortalContainerProvider>
    )
    await userEvent.click(screen.getByText('abrir'))
    expect(container.contains(await screen.findByText('item'))).toBe(true)
    container.remove()
  })
})
