// @vitest-environment jsdom
import '@/test/jsdom-setup'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChannelWelcome, DaySeparator, JumpToPresentBar, UnreadDivider } from './ChatChrome'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ChatChrome', () => {
  it('divisor de não lidas é vermelho com NOVAS', () => {
    const { container } = render(<UnreadDivider />)
    expect(screen.getByText('NOVAS')).toBeTruthy()
    expect(container.querySelector('[data-unread-divider="true"]')).toBeTruthy()
    expect(container.innerHTML).toContain('border-destructive')
  })
  it('separador de data mostra o rótulo', () => {
    render(<DaySeparator label="8 de novembro de 2026" />)
    expect(screen.getByText('8 de novembro de 2026')).toBeTruthy()
  })
  it('boas-vindas do canal', () => {
    render(<ChannelWelcome title="Boas-vindas a #geral!" subtitle="Este é o começo do canal #geral." icon={null} />)
    expect(screen.getByRole('heading', { name: 'Boas-vindas a #geral!' })).toBeTruthy()
    expect(screen.getByText('Este é o começo do canal #geral.')).toBeTruthy()
  })
  it('faixa de mensagens antigas chama o pulo', async () => {
    const onJump = vi.fn()
    render(<JumpToPresentBar onJump={onJump} />)
    expect(screen.getByText('Você está vendo mensagens antigas')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Ir para o presente' }))
    expect(onJump).toHaveBeenCalledOnce()
  })
})
