// @vitest-environment jsdom
import '@/test/jsdom-setup'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AVATAR_BG, avatarColorIndex } from '@/lib/avatar-color'
import { UserAvatar } from './UserAvatar'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UserAvatar', () => {
  it('mostra a estrela sobre a cor do id quando não há foto', () => {
    render(<UserAvatar userId="u1" name="Leo" size={32} />)
    const fb = screen.getByRole('img', { name: 'Hydra' }).closest('[data-slot="avatar-fallback"]')!
    expect(fb.className).toContain(AVATAR_BG[avatarColorIndex('u1')])
  })
  it('mantém o fallback montado enquanto a foto não carrega', () => {
    render(<UserAvatar userId="u1" name="Leo" avatarUrl="https://lh3.googleusercontent.com/x" size={40} />)
    expect(screen.getByRole('img', { name: 'Hydra' })).toBeTruthy()
  })
  it('nunca mostra iniciais', () => {
    const { container } = render(<UserAvatar userId="u1" name="Leo Santos" size={32} />)
    expect(container.textContent).not.toContain('LS')
  })
  it('mostra a bolinha de status com rótulo', () => {
    render(<UserAvatar userId="u1" name="Leo" size={32} status="online" />)
    expect(screen.getByLabelText('Online')).toBeTruthy()
  })
  it('aplica o tamanho pedido', () => {
    const { container } = render(<UserAvatar userId="u1" name="Leo" size={80} />)
    expect(container.firstElementChild!.className).toContain('size-20')
  })
})
