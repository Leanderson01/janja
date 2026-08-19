import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_SIDEBAR_PREFERENCES,
  loadSidebarPreferences,
  saveSidebarPreferences
} from './sidebar-preferences'

// Mesmo molde do `screenshare-preferences.test.ts`: função pura + stub de
// storage, no ambiente `edge-runtime` global (vitest.config.ts), que NÃO tem
// `localStorage`. Isso é vantagem aqui — o caminho "storage indisponível",
// que este módulo promete nunca deixar explodir, é o estado NATIVO do
// ambiente, e é o caminho feliz que precisa de stub.
//
// O que estes testes provam de verdade, num ambiente sem Windows e sem janela
// do Electron: o CONTRATO de persistência (o que foi salvo é o que volta a ser
// lido — o observável de "sobrevive ao reinício do app" que existe daqui) e o
// contrato defensivo (nenhuma entrada corrompida lança). O reinício de
// verdade, com dois boots do app, é item do roteiro do checkpoint humano
// (Plano 08.5-15/08.5-17).

const STORAGE_KEY = 'janja:sidebar-preferences'

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

describe('sidebar-preferences — sem localStorage nenhum', () => {
  it('load cai no default em vez de lançar', () => {
    expect(() => loadSidebarPreferences()).not.toThrow()
    expect(loadSidebarPreferences()).toEqual(DEFAULT_SIDEBAR_PREFERENCES)
  })

  it('o default é tudo expandido — recolher é escolha, nunca padrão', () => {
    expect(DEFAULT_SIDEBAR_PREFERENCES).toEqual({ textCollapsed: false, voiceCollapsed: false })
  })

  it('save não lança e devolve o valor sanitizado, mesmo sem onde persistir', () => {
    expect(() => saveSidebarPreferences({ voiceCollapsed: true })).not.toThrow()
    expect(saveSidebarPreferences({ voiceCollapsed: true })).toEqual({
      textCollapsed: false,
      voiceCollapsed: true
    })
  })
})

describe('sidebar-preferences — com localStorage', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = installFakeStorage()
  })

  it('sem nada salvo, devolve o default', () => {
    expect(loadSidebarPreferences()).toEqual(DEFAULT_SIDEBAR_PREFERENCES)
  })

  it('o que foi salvo é o que volta a ser lido (persistência entre sessões)', () => {
    saveSidebarPreferences({ voiceCollapsed: true })
    expect(store.get(STORAGE_KEY)).toBe(
      JSON.stringify({ textCollapsed: false, voiceCollapsed: true })
    )
    expect(loadSidebarPreferences()).toEqual({ textCollapsed: false, voiceCollapsed: true })

    saveSidebarPreferences({ voiceCollapsed: false })
    expect(loadSidebarPreferences()).toEqual(DEFAULT_SIDEBAR_PREFERENCES)
  })

  it('as duas seções são independentes e podem estar recolhidas ao mesmo tempo', () => {
    saveSidebarPreferences({ textCollapsed: true })
    saveSidebarPreferences({ voiceCollapsed: true })
    expect(loadSidebarPreferences()).toEqual({ textCollapsed: true, voiceCollapsed: true })
  })

  it('merge com o valor persistido: alternar uma seção não reseta a outra', () => {
    saveSidebarPreferences({ textCollapsed: true })
    expect(saveSidebarPreferences({ voiceCollapsed: true })).toEqual({
      textCollapsed: true,
      voiceCollapsed: true
    })
    expect(saveSidebarPreferences({})).toEqual({ textCollapsed: true, voiceCollapsed: true })
  })

  it.each([
    ['JSON quebrado', '{textCollapsed:'],
    ['tipo errado nos campos', '{"textCollapsed":"sim","voiceCollapsed":1}'],
    ['JSON válido que não é objeto', '"textCollapsed"'],
    ['null literal', 'null'],
    ['array', '[{"textCollapsed":true}]'],
    ['string vazia', ''],
    ['objeto sem os campos esperados', '{"outraCoisa":true}']
  ])('%s cai no default sem lançar', (_caso, raw) => {
    store.set(STORAGE_KEY, raw)
    expect(() => loadSidebarPreferences()).not.toThrow()
    expect(loadSidebarPreferences()).toEqual(DEFAULT_SIDEBAR_PREFERENCES)
  })

  it('campo corrompido não contamina o campo válido ao lado', () => {
    store.set(STORAGE_KEY, '{"textCollapsed":true,"voiceCollapsed":"talvez"}')
    expect(loadSidebarPreferences()).toEqual({ textCollapsed: true, voiceCollapsed: false })
  })

  it('setItem que lança (quota) não derruba quem chamou', () => {
    installFakeStorage({
      setItem: () => {
        throw new Error('QuotaExceededError')
      }
    })
    expect(() => saveSidebarPreferences({ voiceCollapsed: true })).not.toThrow()
    expect(saveSidebarPreferences({ voiceCollapsed: true })).toEqual({
      textCollapsed: false,
      voiceCollapsed: true
    })
  })

  it('getItem que lança não derruba a leitura', () => {
    installFakeStorage({
      getItem: () => {
        throw new Error('SecurityError')
      }
    })
    expect(loadSidebarPreferences()).toEqual(DEFAULT_SIDEBAR_PREFERENCES)
  })
})
