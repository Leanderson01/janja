import { describe, expect, it } from 'vitest'
import { friendsForTab } from './friends-tabs'

describe('friendsForTab', () => {
  it('aba Online filtra', () =>
    expect(friendsForTab([{ online: true }, { online: false }], 'online')).toHaveLength(1))
  it('aba Todos mostra todos', () =>
    expect(friendsForTab([{ online: true }, { online: false }], 'todos')).toHaveLength(2))
})
