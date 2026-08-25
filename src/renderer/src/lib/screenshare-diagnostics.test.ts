// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  instrumentGetDisplayMedia,
  isRestrictOwnAudioSupported,
  logCaptureSupport,
  logPublishedScreenShareAudio
} from './screenshare-diagnostics'

// O diagnóstico do Pitfall 1 roda no caminho crítico de iniciar um
// compartilhamento. A promessa que estes testes cobram não é "imprime bonito"
// — é que ele NUNCA derruba o compartilhamento que veio diagnosticar, em
// nenhuma forma de ambiente hostil, e que a instrumentação de
// `getDisplayMedia` é transparente: mesmo retorno, mesmas rejeições, original
// restaurado.
//
// jsdom porque o módulo lê `navigator.mediaDevices` e `window.electron`;
// nenhum dos dois existe de verdade aqui, o que é justamente o pior caso.

type Supported = Record<string, unknown> | (() => never)

function stubMediaDevices(value: unknown): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    value,
    configurable: true,
    writable: true
  })
}

function withSupportedConstraints(supported: Supported): void {
  stubMediaDevices({
    getSupportedConstraints: typeof supported === 'function' ? supported : () => supported
  })
}

/** Uma MediaStreamTrack o suficiente para o que o módulo lê. */
function fakeTrack(overrides: Record<string, unknown> = {}): MediaStreamTrack {
  return {
    label: 'System Audio',
    readyState: 'live',
    getSettings: () => ({ sampleRate: 48000 }),
    getConstraints: () => ({ restrictOwnAudio: true }),
    ...overrides
  } as unknown as MediaStreamTrack
}

function fakeStream(audio: MediaStreamTrack[], video: MediaStreamTrack[] = []): MediaStream {
  return {
    getAudioTracks: () => audio,
    getVideoTracks: () => video
  } as unknown as MediaStream
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'mediaDevices')
})

describe('isRestrictOwnAudioSupported', () => {
  it('true quando o Chromium reconhece a constraint', () => {
    withSupportedConstraints({ restrictOwnAudio: true, echoCancellation: true })
    expect(isRestrictOwnAudioSupported()).toBe(true)
  })

  it('false quando a chave existe mas está desligada', () => {
    withSupportedConstraints({ restrictOwnAudio: false })
    expect(isRestrictOwnAudioSupported()).toBe(false)
  })

  it('false quando a chave nem existe — o caso que descarta a constraint em silêncio', () => {
    // É esta a hipótese que fecha a causa raiz do eco: a constraint é passada,
    // aceita sem erro, e jogada fora porque a engine não a conhece.
    withSupportedConstraints({ echoCancellation: true, noiseSuppression: true })
    expect(isRestrictOwnAudioSupported()).toBe(false)
  })

  it('"indisponível" em vez de exceção quando não há mediaDevices', () => {
    stubMediaDevices(undefined)
    expect(isRestrictOwnAudioSupported()).toBe('indisponível')
  })

  it('"indisponível" quando getSupportedConstraints lança', () => {
    withSupportedConstraints(() => {
      throw new Error('sem permissão')
    })
    expect(isRestrictOwnAudioSupported()).toBe('indisponível')
  })
})

describe('logCaptureSupport', () => {
  it('avisa em voz alta quando o áudio está ligado e a constraint é descartada', () => {
    withSupportedConstraints({})
    logCaptureSupport(true)

    const warnings = vi.mocked(console.warn).mock.calls.flat().join(' ')
    expect(warnings).toContain('DESCARTADA EM SILÊNCIO')
  })

  it('não alarma quando o áudio de sistema está desligado', () => {
    withSupportedConstraints({})
    logCaptureSupport(false)

    // Sem loopback concedido não há eco possível — avisar aqui seria ruído.
    expect(console.warn).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalled()
  })

  it('nunca lança, mesmo sem navigator.mediaDevices', () => {
    stubMediaDevices(undefined)
    expect(() => logCaptureSupport(true)).not.toThrow()
  })
})

describe('instrumentGetDisplayMedia', () => {
  it('devolve o mesmo stream e restaura o original', async () => {
    const stream = fakeStream([fakeTrack()], [fakeTrack({ label: 'Tela 1' })])
    const original = vi.fn(async () => stream)
    stubMediaDevices({ getDisplayMedia: original })

    const restore = instrumentGetDisplayMedia()
    expect(navigator.mediaDevices.getDisplayMedia).not.toBe(original)

    // `restrictOwnAudio` não existe em `MediaTrackConstraints` da lib DOM do
    // TypeScript — o que já é meio caminho do diagnóstico: é uma constraint
    // fora do padrão que a plataforma pode simplesmente não conhecer.
    const constraints = {
      video: true,
      audio: { restrictOwnAudio: true }
    } as unknown as DisplayMediaStreamOptions
    await expect(navigator.mediaDevices.getDisplayMedia(constraints)).resolves.toBe(stream)
    expect(original).toHaveBeenCalledWith(constraints)

    restore()
    // Sem isto, cada compartilhamento empilharia mais um wrapper e o console
    // logaria N vezes na N-ésima tentativa.
    expect(navigator.mediaDevices.getDisplayMedia).toBe(original)
  })

  it('deixa a rejeição subir intacta — cancelar é o caminho comum', async () => {
    const boom = new Error('Permission denied by system')
    const original = vi.fn(async () => {
      throw boom
    })
    stubMediaDevices({ getDisplayMedia: original })

    const restore = instrumentGetDisplayMedia()
    // Engolir isto quebraria `startScreenShare()`: o botão ficaria achando
    // que publicou algo que nunca existiu.
    await expect(navigator.mediaDevices.getDisplayMedia({})).rejects.toBe(boom)
    restore()
  })

  it('reporta quantas tracks de áudio vieram, inclusive o caso de mais de uma', async () => {
    const stream = fakeStream([fakeTrack(), fakeTrack({ label: 'Outra' })], [fakeTrack()])
    stubMediaDevices({ getDisplayMedia: async () => stream })

    const restore = instrumentGetDisplayMedia()
    await navigator.mediaDevices.getDisplayMedia({})
    restore()

    const logs = vi.mocked(console.log).mock.calls.flat().join(' ')
    expect(logs).toContain('3/4')
    // O `livekit-client` fica com `getAudioTracks()[0]` e descarta o resto sem
    // dizer nada; o diagnóstico é o único lugar onde isso aparece.
    expect(logs).toContain('APENAS a primeira')
  })

  it('uma track que lança em getSettings não derruba a captura', async () => {
    const hostile = fakeTrack({
      getSettings: () => {
        throw new Error('InvalidStateError')
      }
    })
    const stream = fakeStream([hostile])
    stubMediaDevices({ getDisplayMedia: async () => stream })

    const restore = instrumentGetDisplayMedia()
    await expect(navigator.mediaDevices.getDisplayMedia({})).resolves.toBe(stream)
    restore()
  })

  it('sem getDisplayMedia no ambiente, devolve um restore inofensivo', () => {
    stubMediaDevices({})
    const restore = instrumentGetDisplayMedia()
    expect(() => restore()).not.toThrow()
  })
})

describe('logPublishedScreenShareAudio', () => {
  it('sem track e com áudio desligado, registra que é o esperado', () => {
    withSupportedConstraints({})
    logPublishedScreenShareAudio(null, false)

    const logs = vi.mocked(console.log).mock.calls.flat().join(' ')
    expect(logs).toContain('eco zero')
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('sem track mas com áudio ligado, aponta o processo main', () => {
    withSupportedConstraints({ restrictOwnAudio: true })
    logPublishedScreenShareAudio(null, true)

    const logs = vi.mocked(console.log).mock.calls.flat().join(' ')
    expect(logs).toContain('não concedeu loopback')
  })

  it('veredito de "premissa falsa" quando a constraint não é reconhecida', () => {
    withSupportedConstraints({})
    logPublishedScreenShareAudio(fakeTrack(), true)

    const warnings = vi.mocked(console.warn).mock.calls.flat().join(' ')
    expect(warnings).toContain('VEREDITO')
    expect(warnings).toContain('premissa da Fase 8 é falsa')
  })

  it('veredito de "se perdeu no caminho" quando some da track publicada', () => {
    withSupportedConstraints({ restrictOwnAudio: true })
    logPublishedScreenShareAudio(
      fakeTrack({ getConstraints: () => ({}), getSettings: () => ({}) }),
      true
    )

    const warnings = vi.mocked(console.warn).mock.calls.flat().join(' ')
    expect(warnings).toContain('se perdeu no caminho')
  })

  it('veredito de "aplicada e insuficiente" quando a flag chegou à track', () => {
    withSupportedConstraints({ restrictOwnAudio: true })
    logPublishedScreenShareAudio(fakeTrack(), true)

    const logs = vi.mocked(console.log).mock.calls.flat().join(' ')
    // Este é o veredito que manda buscar o plano B do Pitfall 1 em vez de
    // continuar procurando defeito no caminho da constraint.
    expect(logs).toContain('INSUFICIENTE')
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('nunca lança com uma track hostil', () => {
    withSupportedConstraints({ restrictOwnAudio: true })
    const hostile = fakeTrack({
      getConstraints: () => {
        throw new Error('InvalidStateError')
      }
    })
    expect(() => logPublishedScreenShareAudio(hostile, true)).not.toThrow()
  })
})
