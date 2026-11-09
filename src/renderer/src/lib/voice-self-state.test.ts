import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_VOICE_SELF_STATE,
  loadVoiceSelfState,
  resolveSavedDevice,
  saveVoiceSelfState,
  toggleDeafen,
  toggleMute
} from './voice-self-state'

// Mesmo arranjo de `participant-volumes.test.ts`: o ambiente padrão dos testes
// (`edge-runtime`) não tem `localStorage`, então o caminho "storage
// indisponível" é o nativo e o caminho feliz precisa de um stub.

const STORAGE_KEY = 'janja:voice-self-state'

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

const base = DEFAULT_VOICE_SELF_STATE

describe('voice-self-state — mic e fone', () => {
  it('mutar e desmutar', () => expect(toggleMute(toggleMute(base)).muted).toBe(false))

  it('ensurdecer também muta e lembra o estado anterior', () =>
    expect(toggleDeafen(base)).toMatchObject({
      deafened: true,
      muted: true,
      mutedBeforeDeafen: false
    }))

  it('desensurdecer volta o mic como estava (aberto)', () =>
    expect(toggleDeafen(toggleDeafen(base)).muted).toBe(false))

  it('desensurdecer volta o mic como estava (mutado)', () => {
    const s = toggleDeafen(toggleMute(base))
    expect(toggleDeafen(s)).toMatchObject({ deafened: false, muted: true })
  })

  it('clicar no mic ensurdecido desensurdece e desmuta', () =>
    expect(toggleMute(toggleDeafen(base))).toMatchObject({ deafened: false, muted: false }))

  it('nunca muda os dispositivos escolhidos', () => {
    const s = { ...base, inputDeviceId: 'mic-usb', outputDeviceId: 'fone-usb' }
    expect(toggleMute(s)).toMatchObject({ inputDeviceId: 'mic-usb', outputDeviceId: 'fone-usb' })
    expect(toggleDeafen(s)).toMatchObject({ inputDeviceId: 'mic-usb', outputDeviceId: 'fone-usb' })
  })
})

describe('voice-self-state — persistência', () => {
  beforeEach(() => {
    installFakeStorage()
  })

  it('persiste entre recarregamentos', () => {
    saveVoiceSelfState({ ...base, muted: true, inputDeviceId: 'mic-usb' })
    expect(loadVoiceSelfState()).toMatchObject({ muted: true, inputDeviceId: 'mic-usb' })
  })

  it('dado salvo corrompido volta ao padrão', () => {
    localStorage.setItem(STORAGE_KEY, '{"muted":"sim"}')
    expect(loadVoiceSelfState()).toEqual(base)
  })

  it('JSON inválido volta ao padrão', () => {
    localStorage.setItem(STORAGE_KEY, '{muted')
    expect(loadVoiceSelfState()).toEqual(base)
  })

  it('ensurdecido salvo sem mutado volta mutado (ensurdecer sempre implica mutado)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...base, deafened: true, muted: false }))
    expect(loadVoiceSelfState()).toMatchObject({ deafened: true, muted: true })
  })

  it('id de dispositivo vazio vira padrão (null)', () => {
    saveVoiceSelfState({ ...base, inputDeviceId: '', outputDeviceId: '' })
    expect(loadVoiceSelfState()).toMatchObject({ inputDeviceId: null, outputDeviceId: null })
  })
})

describe('voice-self-state — sem localStorage nenhum', () => {
  it('load devolve o padrão em vez de lançar', () => {
    expect(loadVoiceSelfState()).toEqual(base)
  })

  it('save não lança', () => {
    expect(() => saveVoiceSelfState({ ...base, muted: true })).not.toThrow()
  })

  it('getItem que lança devolve o padrão', () => {
    installFakeStorage({
      getItem: () => {
        throw new Error('SecurityError')
      }
    })
    expect(loadVoiceSelfState()).toEqual(base)
  })

  it('setItem que lança (quota) não derruba quem salvou', () => {
    installFakeStorage({
      setItem: () => {
        throw new Error('QuotaExceededError')
      }
    })
    expect(() => saveVoiceSelfState({ ...base, muted: true })).not.toThrow()
  })
})

describe('voice-self-state — dispositivo salvo', () => {
  it('dispositivo salvo que sumiu cai para o padrão', () =>
    expect(resolveSavedDevice('mic-usb', [{ deviceId: 'default' }])).toBeNull())

  it('dispositivo salvo presente é mantido', () =>
    expect(resolveSavedDevice('mic-usb', [{ deviceId: 'mic-usb' }])).toBe('mic-usb'))

  it('nada salvo é padrão', () =>
    expect(resolveSavedDevice(null, [{ deviceId: 'mic-usb' }])).toBeNull())
})
