import { describe, expect, it } from 'vitest'
import {
  EMPTY_HISTORY,
  MAX_HISTORY,
  navBack,
  navBackWhere,
  navForward,
  navForwardWhere,
  navPush
} from './nav-history'

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

describe('nav-history com entradas mortas', () => {
  const d = { ...a, channelId: 'c3' }
  const dead = (e: { channelId: string | null }): boolean => e.channelId !== 'c2'
  const live = (e: { channelId: string | null }): boolean => !dead(e)
  const h3 = navPush(navPush(navPush(EMPTY_HISTORY, a), b), d)

  it('pula entrada morta ao voltar', () => {
    const r = navBackWhere(h3, (e) => e.channelId !== 'c2')!
    expect(r.entry).toEqual(a)
    expect(r.history.index).toBe(0)
  })
  it('pula entrada morta ao avançar', () => {
    const r = navForwardWhere({ ...h3, index: 0 }, (e) => e.channelId !== 'c2')!
    expect(r.entry).toEqual(d)
    expect(r.history.index).toBe(2)
  })
  it('devolve null quando todas as anteriores estão mortas', () => {
    expect(navBackWhere(h3, () => false)).toBeNull()
    expect(navBackWhere(h3, live)).not.toBeNull()
    expect(navForwardWhere(h3, () => true)).toBeNull()
  })
  it('devolve direto a entrada viva ao lado do cursor', () => {
    const r = navBackWhere(h3, () => true)!
    expect(r.entry).toEqual(b)
    expect(r.history.index).toBe(1)
  })
})
