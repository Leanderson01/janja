import { describe, expect, it } from 'vitest'

import { shouldShowJumpBar } from './jump-bar'

describe('shouldShowJumpBar', () => {
  it('escondida no fim da conversa', () =>
    expect(shouldShowJumpBar({ isViewingOld: false, newMessageCount: 0 })).toBe(false))
  it('aparece lendo mensagens antigas', () =>
    expect(shouldShowJumpBar({ isViewingOld: true, newMessageCount: 0 })).toBe(true))
  it('aparece com mensagens novas mesmo sem estar longe', () =>
    expect(shouldShowJumpBar({ isViewingOld: false, newMessageCount: 2 })).toBe(true))
})
