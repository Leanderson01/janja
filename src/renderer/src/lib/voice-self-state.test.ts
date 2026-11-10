import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_VOICE_SELF_STATE,
  loadVoiceSelfState,
  resolveSavedDevice,
  saveVoiceSelfState,
  shouldPublishMicrophoneMuted,
  toggleDeafen,
  toggleMute,
  toneForSelfStateChange
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

// Decisão do join: publicar o microfone já mutado ou aberto. Publicar aberto
// manda `muted:false` no AddTrackRequest, e o SFU repassa áudio até o mute do
// cliente chegar — por isso todo caso em que ninguém deveria te ouvir publica
// mutado.
describe('voice-self-state — publicar o microfone mutado no join', () => {
  const unmuted = { muted: false, deafened: false }

  it('modo VAD desmutado publica aberto (o VAD fecha depois, como sempre)', () =>
    expect(shouldPublishMicrophoneMuted({ ...unmuted, mode: 'vad', pttKeyDown: false })).toBe(
      false
    ))

  it('modo VAD mutado publica mutado', () =>
    expect(
      shouldPublishMicrophoneMuted({ muted: true, deafened: false, mode: 'vad', pttKeyDown: false })
    ).toBe(true))

  it('ensurdecido publica mutado, mesmo com muted falso', () =>
    expect(
      shouldPublishMicrophoneMuted({ muted: false, deafened: true, mode: 'vad', pttKeyDown: false })
    ).toBe(true))

  it('modo PTT com a tecla solta publica mutado', () =>
    expect(shouldPublishMicrophoneMuted({ ...unmuted, mode: 'ptt', pttKeyDown: false })).toBe(true))

  it('modo PTT segurando a tecla publica aberto', () =>
    expect(shouldPublishMicrophoneMuted({ ...unmuted, mode: 'ptt', pttKeyDown: true })).toBe(false))

  it('modo PTT segurando a tecla mas mutado publica mutado', () =>
    expect(
      shouldPublishMicrophoneMuted({ muted: true, deafened: false, mode: 'ptt', pttKeyDown: true })
    ).toBe(true))

  it('modo PTT segurando a tecla mas ensurdecido publica mutado', () =>
    expect(
      shouldPublishMicrophoneMuted({ muted: true, deafened: true, mode: 'ptt', pttKeyDown: true })
    ).toBe(true))
})

// Follow-up 1: tons de mic e fone como no Discord. Decisão do Leo: ensurdecer e
// desensurdecer agora TÊM tom próprio (revoga a regra antiga de nunca tocar do
// lado do fone), e ensurdecer não toca o tom de mutar junto.
describe('voice-self-state — tom de cada clique', () => {
  // Cada caso aplica o clique de verdade (toggleMute/toggleDeafen) e pergunta
  // qual tom aquela mudança toca.
  function toneOf(prev: typeof base, click: (s: typeof base) => typeof base): string | null {
    return toneForSelfStateChange(prev, click(prev))
  }

  it('mutar toca o tom de mutar; desmutar, o de desmutar', () => {
    expect(toneOf(base, toggleMute)).toBe('mute')
    expect(toneOf(toggleMute(base), toggleMute)).toBe('unmute')
  })

  it('ensurdecer toca o tom de ensurdecer, e não o de mutar junto', () => {
    expect(toneOf(base, toggleDeafen)).toBe('deafen')
    expect(toneOf(toggleMute(base), toggleDeafen)).toBe('deafen')
  })

  it('desensurdecer toca o tom de desensurdecer (com o mic voltando aberto ou mutado)', () => {
    expect(toneOf(toggleDeafen(base), toggleDeafen)).toBe('undeafen')
    expect(toneOf(toggleDeafen(toggleMute(base)), toggleDeafen)).toBe('undeafen')
  })

  it('clicar no mic ensurdecido (desensurdece e desmuta) toca o de desensurdecer', () => {
    expect(toneOf(toggleDeafen(base), toggleMute)).toBe('undeafen')
  })

  it('o que não é mic nem fone não toca nada', () => {
    const trocouMicrofone = { ...base, inputDeviceId: 'mic-usb' }
    expect(toneForSelfStateChange(base, trocouMicrofone)).toBeNull()
    expect(toneForSelfStateChange(base, base)).toBeNull()
  })
})
