import { describe, expect, it } from 'vitest'
import { buildTimeline, type TimelineItem } from './message-grouping'

type M = { id: string; author: string | null; at: number }
const m = (id: string, author: string | null, h: number, min: number, day = 9): M => ({
  id,
  author,
  at: new Date(2026, 10, day, h, min).getTime()
})
const opts = {
  getId: (x: M) => x.id,
  getAuthorId: (x: M) => x.author,
  getCreatedAt: (x: M) => x.at
}
const starts = (items: TimelineItem<M>[]): boolean[] =>
  items.flatMap((i) => (i.kind === 'message' ? [i.isGroupStart] : []))

describe('buildTimeline', () => {
  it('mesma pessoa em 7 minutos agrupa', () =>
    expect(starts(buildTimeline([m('1', 'a', 10, 0), m('2', 'a', 10, 6)], opts))).toEqual([true, false]))
  it('mais de 7 minutos abre grupo novo', () =>
    expect(starts(buildTimeline([m('1', 'a', 10, 0), m('2', 'a', 10, 8)], opts))).toEqual([true, true]))
  it('outra pessoa abre grupo novo', () =>
    expect(starts(buildTimeline([m('1', 'a', 10, 0), m('2', 'b', 10, 1)], opts))).toEqual([true, true]))
  it('autor desconhecido nunca agrupa', () =>
    expect(starts(buildTimeline([m('1', null, 10, 0), m('2', null, 10, 1)], opts))).toEqual([true, true]))
  it('separador de data entre dias, e ele quebra o grupo', () => {
    const items = buildTimeline([m('1', 'a', 23, 58, 8), m('2', 'a', 0, 1, 9)], opts)
    expect(items.map((i) => i.kind)).toEqual(['day', 'message', 'day', 'message'])
    expect(starts(items)).toEqual([true, true])
  })
  it('divisor NOVAS antes da primeira não lida, e ele quebra o grupo', () => {
    const items = buildTimeline([m('1', 'a', 10, 0), m('2', 'a', 10, 1)], { ...opts, unreadMessageId: '2' })
    expect(items.map((i) => i.kind)).toEqual(['day', 'message', 'unread', 'message'])
    expect(starts(items)).toEqual([true, true])
  })
})
