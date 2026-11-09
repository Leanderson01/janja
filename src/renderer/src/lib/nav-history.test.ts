import { describe, expect, it } from 'vitest'
import { EMPTY_HISTORY, MAX_HISTORY, navBack, navForward, navPush } from './nav-history'

const a = { view: 'server', serverId: 's1', channelId: 'c1', dmChannelId: null } as const
const b = { ...a, channelId: 'c2' }
const c = { view: 'home', serverId: null, channelId: null, dmChannelId: 'd1' } as const

describe('nav-history', () => {
  it('empilha e volta', () => {
    const h = navPush(navPush(EMPTY_HISTORY, a), b)
    expect(navBack(h)!.entry).toEqual(a)
  })
  it('voltar no começo devolve null', () => expect(navBack(navPush(EMPTY_HISTORY, a))).toBeNull())
  it('avançar depois de voltar', () => {
    const back = navBack(navPush(navPush(EMPTY_HISTORY, a), b))!
    expect(navForward(back.history)!.entry).toEqual(b)
  })
  it('navegar depois de voltar descarta o futuro', () => {
    const back = navBack(navPush(navPush(EMPTY_HISTORY, a), b))!
    expect(navForward(navPush(back.history, c))).toBeNull()
  })
  it('não duplica a mesma entrada seguida', () =>
    expect(navPush(navPush(EMPTY_HISTORY, a), a).entries).toHaveLength(1))
  it('guarda no máximo 50', () => {
    let h = EMPTY_HISTORY
    for (let i = 0; i < 60; i++) h = navPush(h, { ...a, channelId: `c${i}` })
    expect(h.entries).toHaveLength(MAX_HISTORY)
    expect(h.entries[0].channelId).toBe('c10')
  })
})
