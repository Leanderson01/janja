import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_PARTICIPANT_VOLUME,
  MAX_PLAYBACK_VOLUME,
  MAX_STORED_VOLUME,
  clampStoredVolume,
  effectiveVolume,
  isDefaultPreference,
  loadParticipantVolumes,
  saveParticipantVolumes
} from './participant-volumes'

// O ambiente de teste do projeto é `edge-runtime` (vitest.config.ts), que NÃO
// tem `localStorage` — a mesma vantagem registrada em
// `screenshare-preferences.test.ts`: o caminho "storage indisponível", que este
// módulo promete nunca deixar explodir, é o estado NATIVO do ambiente, e é o
// caminho feliz que precisa de stub.
//
// O que estes testes provam num WSL2 sem áudio, sem janela e sem segunda
// pessoa: (1) o contrato de persistência — o que foi salvo é o que volta a ser
// lido, que é o "sobrevive ao reinício do app" observável daqui; (2) o contrato
// defensivo — nada corrompido lança; e (3) a REGRA DE PRECEDÊNCIA entre
// ensurdecer, silenciar e volume, que é a única parte auditável de uma feature
// cujo efeito final é audível. Embutida dentro de um componente, essa regra
// seria intestável — é exatamente por isso que ela mora numa função pura.

const STORAGE_KEY = 'janja:participant-volumes'

const ALICE = 'k17abcalice'
const BOB = 'k17abcbob'

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

describe('participant-volumes — sem localStorage nenhum', () => {
  it('load devolve mapa vazio em vez de lançar', () => {
    expect(loadParticipantVolumes()).toEqual({})
  })

  it('save não lança e devolve o mapa podado, mesmo sem onde persistir', () => {
    expect(() =>
      saveParticipantVolumes({ [ALICE]: { volume: 0.5, silenced: false } })
    ).not.toThrow()
    expect(saveParticipantVolumes({ [ALICE]: { volume: 0.5, silenced: false } })).toEqual({
      [ALICE]: { volume: 0.5, silenced: false }
    })
  })
})

describe('participant-volumes — persistência por máquina', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = installFakeStorage()
  })

  it('sem nada salvo, ninguém tem preferência', () => {
    expect(loadParticipantVolumes()).toEqual({})
  })

  it('o que foi salvo é o que volta a ser lido (sobrevive ao reinício do app)', () => {
    saveParticipantVolumes({
      [ALICE]: { volume: 0.3, silenced: false },
      [BOB]: { volume: 1, silenced: true }
    })

    expect(store.get(STORAGE_KEY)).toBe(
      JSON.stringify({
        [ALICE]: { volume: 0.3, silenced: false },
        [BOB]: { volume: 1, silenced: true }
      })
    )
    expect(loadParticipantVolumes()).toEqual({
      [ALICE]: { volume: 0.3, silenced: false },
      [BOB]: { volume: 1, silenced: true }
    })
  })

  it('salvar o mapa inteiro REMOVE quem saiu dele (não faz merge)', () => {
    saveParticipantVolumes({ [ALICE]: { volume: 0.3, silenced: false } })
    saveParticipantVolumes({ [BOB]: { volume: 0.7, silenced: false } })

    expect(loadParticipantVolumes()).toEqual({ [BOB]: { volume: 0.7, silenced: false } })
  })

  it('a chave é a identity do LiveKit (users._id) e é preservada literalmente', () => {
    saveParticipantVolumes({ [ALICE]: { volume: 0, silenced: false } })
    expect(Object.keys(loadParticipantVolumes())).toEqual([ALICE])
  })
})

describe('participant-volumes — limites do volume', () => {
  beforeEach(() => {
    installFakeStorage()
  })

  it.each([
    ['acima do teto', 9, MAX_STORED_VOLUME],
    ['exatamente no teto', 2, 2],
    ['negativo', -3, 0],
    ['zero', 0, 0],
    ['fração normal', 0.45, 0.45]
  ])('%s: %s é grampeado para %s', (_caso, entrada, esperado) => {
    expect(clampStoredVolume(entrada)).toBe(esperado)
    saveParticipantVolumes({ [ALICE]: { volume: entrada, silenced: false } })
    expect(loadParticipantVolumes()[ALICE]?.volume ?? DEFAULT_PARTICIPANT_VOLUME).toBe(esperado)
  })

  it.each([NaN, Infinity, -Infinity])('%s não é volume: vira o padrão', (entrada) => {
    expect(clampStoredVolume(entrada)).toBe(DEFAULT_PARTICIPANT_VOLUME)
  })
})

describe('participant-volumes — poda do padrão ao salvar', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = installFakeStorage()
  })

  it('entrada em volume 1 e não silenciada não é guardada', () => {
    expect(isDefaultPreference({ volume: 1, silenced: false })).toBe(true)

    const saved = saveParticipantVolumes({
      [ALICE]: { volume: 1, silenced: false },
      [BOB]: { volume: 0.2, silenced: false }
    })

    expect(saved).toEqual({ [BOB]: { volume: 0.2, silenced: false } })
    expect(store.get(STORAGE_KEY)).toBe(JSON.stringify({ [BOB]: { volume: 0.2, silenced: false } }))
  })

  it('volume 1 COM silenciado continua guardado — não é o padrão', () => {
    expect(isDefaultPreference({ volume: 1, silenced: true })).toBe(false)
    expect(saveParticipantVolumes({ [ALICE]: { volume: 1, silenced: true } })).toEqual({
      [ALICE]: { volume: 1, silenced: true }
    })
  })

  it('voltar alguém para o volume normal apaga a entrada dele', () => {
    saveParticipantVolumes({ [ALICE]: { volume: 0.1, silenced: false } })
    saveParticipantVolumes({ [ALICE]: { volume: 1, silenced: false } })
    expect(loadParticipantVolumes()).toEqual({})
  })
})

describe('participant-volumes — nada corrompido derruba a call', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = installFakeStorage()
  })

  it.each([
    ['JSON quebrado', '{"a":'],
    ['JSON válido que não é objeto', '"0.5"'],
    ['null literal', 'null'],
    ['array no topo', '[{"volume":1}]'],
    ['string vazia', ''],
    ['número no topo', '42']
  ])('%s cai no mapa vazio sem lançar', (_caso, raw) => {
    store.set(STORAGE_KEY, raw)
    expect(() => loadParticipantVolumes()).not.toThrow()
    expect(loadParticipantVolumes()).toEqual({})
  })

  it.each([
    ['valor escalar', `{"${ALICE}":0.5}`],
    ['valor nulo', `{"${ALICE}":null}`],
    ['valor array', `{"${ALICE}":[0.5]}`]
  ])('chave com %s é descartada, as outras sobrevivem', (_caso, raw) => {
    store.set(STORAGE_KEY, raw.replace('}', `,"${BOB}":{"volume":0.4,"silenced":false}}`))
    expect(loadParticipantVolumes()).toEqual({ [BOB]: { volume: 0.4, silenced: false } })
  })

  it('campos com tipo errado caem no padrão do campo, sem descartar a chave', () => {
    store.set(STORAGE_KEY, `{"${ALICE}":{"volume":"alto","silenced":"sim"}}`)
    expect(loadParticipantVolumes()).toEqual({ [ALICE]: { volume: 1, silenced: false } })
  })

  it('setItem que lança (quota) não derruba quem chamou', () => {
    installFakeStorage({
      setItem: () => {
        throw new Error('QuotaExceededError')
      }
    })
    expect(() =>
      saveParticipantVolumes({ [ALICE]: { volume: 0.5, silenced: false } })
    ).not.toThrow()
  })

  it('getItem que lança não derruba a leitura', () => {
    installFakeStorage({
      getItem: () => {
        throw new Error('SecurityError')
      }
    })
    expect(loadParticipantVolumes()).toEqual({})
  })
})

// A tabela que impede a regressão descrita no plano: ensurdecer e volume
// individual escrevem na MESMA propriedade, e a ordem de precedência é o que
// decide quem vence.
describe('effectiveVolume — ensurdecer > silenciado > volume', () => {
  it('ensurdecido zera TUDO, inclusive quem estava no volume máximo', () => {
    expect(effectiveVolume({ volume: 2, silenced: false }, true)).toBe(0)
    expect(effectiveVolume({ volume: 0.5, silenced: false }, true)).toBe(0)
    expect(effectiveVolume({ volume: 1, silenced: true }, true)).toBe(0)
    expect(effectiveVolume(undefined, true)).toBe(0)
  })

  it('silenciado para mim zera só esta pessoa, com a call ouvindo normalmente', () => {
    expect(effectiveVolume({ volume: 2, silenced: true }, false)).toBe(0)
    expect(effectiveVolume({ volume: 0.8, silenced: true }, false)).toBe(0)
    // ...e o vizinho, sem preferência nenhuma, continua no volume normal.
    expect(effectiveVolume(undefined, false)).toBe(DEFAULT_PARTICIPANT_VOLUME)
  })

  it('sem preferência nenhuma, o volume é o normal', () => {
    expect(effectiveVolume(undefined, false)).toBe(1)
    expect(effectiveVolume({ volume: 1, silenced: false }, false)).toBe(1)
  })

  it('o ajuste individual é respeitado quando ninguém está ensurdecido nem silenciado', () => {
    expect(effectiveVolume({ volume: 0, silenced: false }, false)).toBe(0)
    expect(effectiveVolume({ volume: 0.25, silenced: false }, false)).toBe(0.25)
    expect(effectiveVolume({ volume: 0.9, silenced: false }, false)).toBe(0.9)
  })

  // Ver `MAX_PLAYBACK_VOLUME` em participant-volumes.ts: com
  // `webAudioMix: false` (default do livekit-client 2.22, que é o que este
  // projeto usa), `setVolume(v)` faz `el.volume = v`, e `HTMLMediaElement.volume`
  // LANÇA IndexSizeError fora de 0..1. Um valor acima de 1 escapando daqui não
  // "não faria nada": derrubaria a passada que aplica o volume — e junto com
  // ela o ENSURDECIMENTO dos participantes seguintes.
  it('nunca devolve valor que o HTMLMediaElement recusaria', () => {
    expect(MAX_PLAYBACK_VOLUME).toBe(1)
    expect(effectiveVolume({ volume: 2, silenced: false }, false)).toBe(1)
    expect(effectiveVolume({ volume: 1.5, silenced: false }, false)).toBe(1)
    expect(effectiveVolume({ volume: 99, silenced: false }, false)).toBe(1)
    expect(effectiveVolume({ volume: -5, silenced: false }, false)).toBe(0)
    expect(effectiveVolume({ volume: NaN, silenced: false }, false)).toBe(1)
  })

  it('o resultado é sempre um número aceitável para setVolume', () => {
    const casos = [-5, 0, 0.5, 1, 1.7, 2, 100, NaN]
    for (const volume of casos) {
      for (const silenced of [true, false]) {
        for (const deafened of [true, false]) {
          const resultado = effectiveVolume({ volume, silenced }, deafened)
          expect(Number.isFinite(resultado)).toBe(true)
          expect(resultado).toBeGreaterThanOrEqual(0)
          expect(resultado).toBeLessThanOrEqual(MAX_PLAYBACK_VOLUME)
        }
      }
    }
  })
})
