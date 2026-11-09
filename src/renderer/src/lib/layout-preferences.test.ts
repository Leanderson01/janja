import { afterEach, describe, expect, it } from 'vitest'

import {
  clampChannelListWidth,
  loadLayoutPreferences,
  saveLayoutPreferences
} from './layout-preferences'

// O ambiente padrão (edge-runtime) não tem `localStorage`: instalamos um falso,
// no mesmo molde de `participant-volumes.test.ts`.
type FakeStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

function installFakeStorage(overrides: Partial<FakeStorage> = {}): Map<string, string> {
  const store = new Map<string, string>()
  const fake: FakeStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value)
    },
    ...overrides
  }
  ;(globalThis as unknown as { localStorage?: FakeStorage }).localStorage = fake
  return store
}

afterEach(() => {
  delete (globalThis as unknown as { localStorage?: FakeStorage }).localStorage
})

describe('layout-preferences — largura da lista de canais', () => {
  it('largura padrão é 240', () => {
    installFakeStorage()
    expect(loadLayoutPreferences().channelListWidth).toBe(240)
  })

  it('limita ao máximo de 360 numa janela larga', () => {
    expect(clampChannelListWidth(500, 1920, true)).toBe(360)
  })

  it('limita ao mínimo de 240', () => {
    expect(clampChannelListWidth(100, 1920, true)).toBe(240)
  })

  it('na janela mínima garante 400px de chat', () => {
    // 900 - 72 (rail) - 240 (membros) - 400 (chat) = 188 → fica no mínimo 240
    expect(clampChannelListWidth(360, 900, true)).toBe(240)
  })

  it('sem membros sobra mais espaço', () => {
    expect(clampChannelListWidth(360, 900, false)).toBe(360)
  })

  it('valor não numérico vira o mínimo em vez de NaN', () => {
    expect(clampChannelListWidth(Number.NaN, 1920, true)).toBe(240)
  })

  it('valor salvo inválido volta ao padrão', () => {
    installFakeStorage().set(
      'janja:layout-preferences',
      JSON.stringify({ membersVisible: true, channelListWidth: 'x' })
    )
    expect(loadLayoutPreferences().channelListWidth).toBe(240)
  })

  it('o que foi salvo é o que volta', () => {
    installFakeStorage()
    saveLayoutPreferences({ membersVisible: false, channelListWidth: 300 })
    expect(loadLayoutPreferences()).toEqual({ membersVisible: false, channelListWidth: 300 })
  })

  it('preferência antiga só com membersVisible continua válida', () => {
    installFakeStorage().set('janja:layout-preferences', JSON.stringify({ membersVisible: false }))
    expect(loadLayoutPreferences()).toEqual({ membersVisible: false, channelListWidth: 240 })
  })

  it('sem localStorage nenhum não lança', () => {
    expect(loadLayoutPreferences().membersVisible).toBe(true)
    expect(() =>
      saveLayoutPreferences({ membersVisible: true, channelListWidth: 240 })
    ).not.toThrow()
  })
})
