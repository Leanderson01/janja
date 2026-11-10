import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_VOICE_PREFERENCES,
  loadVoicePreferences,
  saveVoicePreferences
} from './voice-preferences'

// Mesmo arranjo de `screenshare-preferences.test.ts`: o ambiente padrão
// (edge-runtime) não tem `localStorage`, então "storage indisponível" é o
// estado nativo e o caminho feliz é o que leva stub.

const STORAGE_KEY = 'janja:voice-preferences'

function installFakeStorage(initial?: unknown): Map<string, string> {
  const store = new Map<string, string>()
  if (initial !== undefined) store.set(STORAGE_KEY, JSON.stringify(initial))
  ;(globalThis as unknown as { localStorage?: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    }
  } as unknown as Storage
  return store
}

afterEach(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage
})

describe('voice-preferences — sensibilidade de entrada em dB', () => {
  it('padrão: automático LIGADO e limiar manual em −50 dB', () => {
    expect(DEFAULT_VOICE_PREFERENCES.vadAutoSensitivity).toBe(true)
    expect(DEFAULT_VOICE_PREFERENCES.vadThresholdDb).toBe(-50)
    expect(DEFAULT_VOICE_PREFERENCES).not.toHaveProperty('vadThreshold')
  })

  it('sem storage nenhum, cai no padrão sem lançar', () => {
    expect(loadVoicePreferences()).toEqual(DEFAULT_VOICE_PREFERENCES)
  })

  it('o que foi salvo é o que volta', () => {
    installFakeStorage()

    saveVoicePreferences({ vadAutoSensitivity: false, vadThresholdDb: -42 })

    expect(loadVoicePreferences()).toMatchObject({
      vadAutoSensitivity: false,
      vadThresholdDb: -42
    })
  })

  it('salvar só o limiar não mexe no automático, no modo nem nos sons', () => {
    installFakeStorage({
      mode: 'ptt',
      vadAutoSensitivity: false,
      vadThresholdDb: -60,
      soundsEnabled: false
    })

    const next = saveVoicePreferences({ vadThresholdDb: -35 })

    expect(next).toEqual({
      mode: 'ptt',
      vadAutoSensitivity: false,
      vadThresholdDb: -35,
      soundsEnabled: false
    })
  })

  it('limiar fora de −100…0 é preso na faixa; não-número cai no padrão', () => {
    installFakeStorage({ vadThresholdDb: -250 })
    expect(loadVoicePreferences().vadThresholdDb).toBe(-100)

    installFakeStorage({ vadThresholdDb: 6 })
    expect(loadVoicePreferences().vadThresholdDb).toBe(0)

    installFakeStorage({ vadThresholdDb: 'alto' })
    expect(loadVoicePreferences().vadThresholdDb).toBe(-50)

    installFakeStorage({ vadThresholdDb: null })
    expect(loadVoicePreferences().vadThresholdDb).toBe(-50)
  })

  it('vadAutoSensitivity que não é boolean cai no padrão (ligado)', () => {
    installFakeStorage({ vadAutoSensitivity: 'false' })

    expect(loadVoicePreferences().vadAutoSensitivity).toBe(true)
  })
})

describe('voice-preferences — migração do limiar linear antigo', () => {
  it('quem tinha `vadThreshold` (RMS 0–1) salvo passa a usar o AUTOMÁTICO', () => {
    // O Leo zerou o limiar antigo para o microfone não cortar. O valor velho
    // era ruim de qualquer jeito (escala linear, padrão de voz alta): não se
    // converte, se descarta.
    installFakeStorage({ mode: 'vad', vadThreshold: 0, soundsEnabled: false })

    const prefs = loadVoicePreferences()

    expect(prefs.vadAutoSensitivity).toBe(true)
    expect(prefs.vadThresholdDb).toBe(-50)
    expect(prefs.soundsEnabled).toBe(false)
    expect(prefs).not.toHaveProperty('vadThreshold')
  })

  it('o campo antigo some do storage na próxima gravação', () => {
    const store = installFakeStorage({ mode: 'vad', vadThreshold: 0.15, soundsEnabled: true })

    saveVoicePreferences({ mode: 'vad' })

    const saved = JSON.parse(store.get(STORAGE_KEY) ?? '{}') as Record<string, unknown>
    expect(saved).not.toHaveProperty('vadThreshold')
    expect(saved).toMatchObject({ vadAutoSensitivity: true, vadThresholdDb: -50 })
  })

  it('JSON corrompido não lança e devolve o padrão', () => {
    const store = installFakeStorage()
    store.set(STORAGE_KEY, '{não é json')

    expect(loadVoicePreferences()).toEqual(DEFAULT_VOICE_PREFERENCES)
  })
})
