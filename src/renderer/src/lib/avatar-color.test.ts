import { describe, expect, it } from 'vitest'
import { AVATAR_BG, AVATAR_TILE_BG, avatarColorIndex } from './avatar-color'

describe('avatarColorIndex', () => {
  it('é estável para o mesmo id', () => expect(avatarColorIndex('k57abc')).toBe(avatarColorIndex('k57abc')))
  it('fica entre 1 e 5', () => {
    for (const id of ['a', 'bb', 'k57x9', 'zzzzzz', '123']) expect([1, 2, 3, 4, 5]).toContain(avatarColorIndex(id))
  })
  it('ids diferentes se espalham pelas 5 cores', () => {
    const seen = new Set(Array.from({ length: 50 }, (_, i) => avatarColorIndex(`user${i}`)))
    expect(seen.size).toBe(5)
  })
  it('expõe as classes como literais', () => {
    expect(AVATAR_BG[3]).toBe('bg-avatar-3')
    expect(AVATAR_TILE_BG[3]).toBe('bg-avatar-3/25')
  })
})
