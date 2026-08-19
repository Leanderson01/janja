import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_SCREEN_SHARE_PREFERENCES,
  loadScreenSharePreferences,
  saveScreenSharePreferences
} from './screenshare-preferences'

// O ambiente de teste do projeto é `edge-runtime` (vitest.config.ts), que NÃO
// tem `localStorage`. Isso é uma vantagem aqui: o caminho "storage
// indisponível" — o que este módulo promete nunca deixar explodir — é o
// estado NATIVO do ambiente, e o caminho feliz é o que precisa de stub.
//
// O que estes testes provam de verdade, num ambiente sem Windows e sem
// janela do Electron: o contrato de persistência (o que foi salvo é o que
// volta a ser lido, que é o "sobrevive ao reinício do app" observável aqui)
// e o contrato defensivo (nenhuma entrada corrompida lança).

const STORAGE_KEY = 'janja:screenshare-preferences'

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

describe('screenshare-preferences — sem localStorage nenhum', () => {
  it('load cai no default em vez de lançar', () => {
    expect(loadScreenSharePreferences()).toEqual(DEFAULT_SCREEN_SHARE_PREFERENCES)
    expect(DEFAULT_SCREEN_SHARE_PREFERENCES.quality).toBe('fluida')
  })

  it('save não lança e devolve o valor sanitizado, mesmo sem onde persistir', () => {
    expect(() => saveScreenSharePreferences({ quality: 'nitida' })).not.toThrow()
    expect(saveScreenSharePreferences({ quality: 'nitida' })).toEqual({ quality: 'nitida' })
  })
})

describe('screenshare-preferences — com localStorage', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = installFakeStorage()
  })

  it('sem nada salvo, devolve o default "fluida"', () => {
    expect(loadScreenSharePreferences()).toEqual({ quality: 'fluida' })
  })

  it('o que foi salvo é o que volta a ser lido (persistência entre sessões)', () => {
    saveScreenSharePreferences({ quality: 'nitida' })
    expect(store.get(STORAGE_KEY)).toBe(JSON.stringify({ quality: 'nitida' }))
    expect(loadScreenSharePreferences()).toEqual({ quality: 'nitida' })

    saveScreenSharePreferences({ quality: 'fluida' })
    expect(loadScreenSharePreferences()).toEqual({ quality: 'fluida' })
  })

  it('merge com o valor persistido: salvar nada não reseta a escolha', () => {
    saveScreenSharePreferences({ quality: 'nitida' })
    expect(saveScreenSharePreferences({})).toEqual({ quality: 'nitida' })
    expect(loadScreenSharePreferences()).toEqual({ quality: 'nitida' })
  })

  it.each([
    ['JSON quebrado', '{quality:'],
    ['valor de qualidade desconhecido', '{"quality":"ultra"}'],
    ['tipo errado no campo', '{"quality":42}'],
    ['JSON válido que não é objeto', '"nitida"'],
    ['null literal', 'null'],
    ['array', '[{"quality":"nitida"}]'],
    ['string vazia', '']
  ])('%s cai no default sem lançar', (_caso, raw) => {
    store.set(STORAGE_KEY, raw)
    expect(() => loadScreenSharePreferences()).not.toThrow()
    expect(loadScreenSharePreferences()).toEqual(DEFAULT_SCREEN_SHARE_PREFERENCES)
  })

  it('setItem que lança (quota) não derruba quem chamou', () => {
    installFakeStorage({
      setItem: () => {
        throw new Error('QuotaExceededError')
      }
    })
    expect(() => saveScreenSharePreferences({ quality: 'nitida' })).not.toThrow()
    expect(saveScreenSharePreferences({ quality: 'nitida' })).toEqual({ quality: 'nitida' })
  })

  it('getItem que lança não derruba a leitura', () => {
    installFakeStorage({
      getItem: () => {
        throw new Error('SecurityError')
      }
    })
    expect(loadScreenSharePreferences()).toEqual(DEFAULT_SCREEN_SHARE_PREFERENCES)
  })
})
