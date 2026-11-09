import { describe, expect, it } from 'vitest'

import { linkAccent } from './link-accent'

describe('linkAccent', () => {
  it('X e Twitter são azuis', () => {
    for (const u of ['https://x.com/a', 'https://twitter.com/a', 'https://mobile.twitter.com/a'])
      expect(linkAccent(u)).toBe('x')
  })
  it('YouTube é vermelho', () => {
    for (const u of [
      'https://www.youtube.com/watch?v=1',
      'https://youtu.be/1',
      'https://m.youtube.com/watch?v=1'
    ])
      expect(linkAccent(u)).toBe('youtube')
  })
  it('resto usa o destaque', () => expect(linkAccent('https://g1.globo.com')).toBe('default'))
  it('não confunde domínio parecido nem URL inválida', () => {
    expect(linkAccent('https://notx.com/a')).toBe('default')
    expect(linkAccent('lixo')).toBe('default')
  })
})
