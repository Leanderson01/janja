// @vitest-environment jsdom
import '@/test/jsdom-setup'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChannelListResizeHandle } from './ChannelListResizeHandle'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ChannelListResizeHandle', () => {
  it('seta para a direita alarga 8px', async () => {
    const onResize = vi.fn()
    render(<ChannelListResizeHandle width={240} onResize={onResize} />)
    screen.getByRole('separator').focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onResize).toHaveBeenCalledWith(248)
  })

  it('seta para a esquerda estreita 8px', async () => {
    const onResize = vi.fn()
    render(<ChannelListResizeHandle width={300} onResize={onResize} />)
    screen.getByRole('separator').focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onResize).toHaveBeenCalledWith(292)
  })

  it('expõe a largura para leitor de tela', () => {
    render(<ChannelListResizeHandle width={300} onResize={vi.fn()} />)
    const sep = screen.getByRole('separator')
    expect(sep.getAttribute('aria-valuenow')).toBe('300')
    expect(sep.getAttribute('aria-valuemin')).toBe('240')
    expect(sep.getAttribute('aria-valuemax')).toBe('360')
    expect(sep.getAttribute('aria-orientation')).toBe('vertical')
  })

  it('arrastar com o ponteiro redimensiona pela diferença do movimento', () => {
    const onResize = vi.fn()
    render(<ChannelListResizeHandle width={240} onResize={onResize} />)
    const sep = screen.getByRole('separator')
    fireEvent.pointerDown(sep, { pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 130 })
    expect(onResize).toHaveBeenLastCalledWith(270)
    fireEvent.pointerUp(sep, { pointerId: 1, clientX: 130 })
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 200 })
    expect(onResize).toHaveBeenCalledTimes(1)
  })
})
