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

describe('screenshare-preferences — o default do áudio é uma decisão travada', () => {
  it('systemAudio nasce DESLIGADO, e inverter isso tem que ser deliberado', () => {
    // Esta asserção não descreve um detalhe de implementação: ela protege uma
    // decisão. Enquanto o item nº 1 do checkpoint 08.6-06 não for confirmado
    // (3+ pessoas numa call real, no Windows, ninguém se ouvindo de volta), a
    // premissa de que o serviço de áudio do Chromium cai dentro da árvore de
    // processos EXCLUÍDA da captura continua não provada. Com ela falsa, um
    // default ligado devolveria o eco de 2026-08-20 para todo mundo de uma
    // vez — e, mesmo com ela verdadeira, ligado manda para a call tudo que a
    // máquina estiver tocando.
    //
    // Se você chegou aqui porque este teste quebrou: ou o checkpoint foi
    // confirmado e a inversão é intencional (troque as duas linhas juntas), ou
    // alguém acabou de ligar o áudio de todo mundo sem querer.
    expect(DEFAULT_SCREEN_SHARE_PREFERENCES.systemAudio).toBe(false)
  })
})

describe('screenshare-preferences — sem localStorage nenhum', () => {
  it('load cai no default em vez de lançar', () => {
    expect(loadScreenSharePreferences()).toEqual(DEFAULT_SCREEN_SHARE_PREFERENCES)
    expect(DEFAULT_SCREEN_SHARE_PREFERENCES.quality).toBe('fluida')
  })

  it('save não lança e devolve o valor sanitizado, mesmo sem onde persistir', () => {
    expect(() => saveScreenSharePreferences({ quality: 'nitida' })).not.toThrow()
    expect(saveScreenSharePreferences({ quality: 'nitida' })).toEqual({
      quality: 'nitida',
      systemAudio: false
    })
  })
})

describe('screenshare-preferences — com localStorage', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = installFakeStorage()
  })

  it('sem nada salvo, devolve o default "fluida" e áudio de sistema DESLIGADO', () => {
    expect(loadScreenSharePreferences()).toEqual({ quality: 'fluida', systemAudio: false })
  })

  it('o que foi salvo é o que volta a ser lido (persistência entre sessões)', () => {
    saveScreenSharePreferences({ quality: 'nitida' })
    expect(store.get(STORAGE_KEY)).toBe(JSON.stringify({ quality: 'nitida', systemAudio: false }))
    expect(loadScreenSharePreferences()).toEqual({ quality: 'nitida', systemAudio: false })

    saveScreenSharePreferences({ quality: 'fluida' })
    expect(loadScreenSharePreferences()).toEqual({ quality: 'fluida', systemAudio: false })
  })

  it('merge com o valor persistido: salvar nada não reseta a escolha', () => {
    saveScreenSharePreferences({ quality: 'nitida' })
    expect(saveScreenSharePreferences({})).toEqual({ quality: 'nitida', systemAudio: false })
    expect(loadScreenSharePreferences()).toEqual({ quality: 'nitida', systemAudio: false })
  })

  // Correção do eco (Pitfall 1): os dois campos são independentes de
  // verdade. Antes deste campo existir, `saveScreenSharePreferences` tinha um
  // único campo e o merge nunca foi exercido de fato — este é o teste que o
  // comentário do módulo prometia.
  it('ligar o áudio de sistema não mexe na qualidade, e vice-versa', () => {
    saveScreenSharePreferences({ quality: 'nitida' })
    expect(saveScreenSharePreferences({ systemAudio: true })).toEqual({
      quality: 'nitida',
      systemAudio: true
    })
    expect(saveScreenSharePreferences({ quality: 'fluida' })).toEqual({
      quality: 'fluida',
      systemAudio: true
    })
    expect(loadScreenSharePreferences().systemAudio).toBe(true)
  })

  it('o áudio de sistema desligado volta a ser lido como desligado', () => {
    saveScreenSharePreferences({ systemAudio: true })
    saveScreenSharePreferences({ systemAudio: false })
    expect(loadScreenSharePreferences().systemAudio).toBe(false)
  })

  // A direção segura tem que ser a direção padrão: nenhum lixo no
  // `localStorage` pode LIGAR o loopback por acidente e trazer o eco de volta.
  it.each([
    ['campo ausente (JSON de uma versão anterior)', '{"quality":"nitida"}'],
    ['string "true" em vez de booleano', '{"systemAudio":"true"}'],
    ['número 1', '{"systemAudio":1}'],
    ['null', '{"systemAudio":null}']
  ])('%s nunca liga o áudio de sistema', (_caso, raw) => {
    store.set(STORAGE_KEY, raw)
    expect(loadScreenSharePreferences().systemAudio).toBe(false)
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
    expect(saveScreenSharePreferences({ quality: 'nitida' })).toEqual({
      quality: 'nitida',
      systemAudio: false
    })
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
