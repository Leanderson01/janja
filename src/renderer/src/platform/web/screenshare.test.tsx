// @vitest-environment jsdom
import { Track, type Room } from 'livekit-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({
  toast: { warning: vi.fn() }
}))
import { toast } from 'sonner'

// Import RELATIVO de propósito: `@platform` resolve para o ELECTRON no
// `vitest.config.ts` (a suíte existente testa o alvo desktop). Quem quer testar
// o alvo web importa pelo caminho, como faz `platform/capabilities.test.ts`.
import { screenShare } from './screenshare'

// O que este arquivo prova: que TODA transmissão de tela na web deixa no
// console a prova do que o navegador concedeu, e avisa a pessoa nos dois casos
// em que ela precisa agir.
//
// Por que isso vale um teste, se "é só um log": o `startAudio` da web não tem
// efeito visível nenhum quando dá certo. Um `return` acidental, um `source`
// trocado, um `getSettings()` lido da faixa errada — nada disso quebraria a
// tela, quebraria a transmissão nem apareceria em code review. Quebraria só o
// experimento do eco (Plano 10-09), meses depois, com três pessoas numa call.

type FakePublication = {
  source: Track.Source
  settings?: Record<string, unknown>
  throwsOnGetSettings?: boolean
}

/**
 * Um `Room` falso com o mínimo que `startAudio` toca:
 * `localParticipant.trackPublications`, um Map cujos valores expõem `source` e
 * `track.mediaStreamTrack.getSettings()`.
 */
function fakeRoom(publications: FakePublication[]): Room {
  const trackPublications = new Map<string, unknown>()

  publications.forEach((publication, index) => {
    trackPublications.set(`sid-${index}`, {
      source: publication.source,
      track: {
        mediaStreamTrack: {
          getSettings: (): Record<string, unknown> => {
            if (publication.throwsOnGetSettings) {
              throw new Error('getSettings explodiu')
            }
            return publication.settings ?? {}
          }
        }
      }
    })
  })

  return { localParticipant: { trackPublications } } as unknown as Room
}

// As linhas de console são coletadas em arrays próprios em vez de lidas de
// `spy.mock.calls`: o tipo devolvido por `vi.spyOn` sobre `console` não é
// escrevível como `ReturnType<typeof vi.spyOn>` (os parâmetros de `console.info`
// não são `unknown[]`), e o typecheck do projeto reprova. Guardar o que
// interessa é mais simples do que descrever o espião.
const infoLines: string[] = []
const warnCalls: unknown[][] = []

beforeEach(() => {
  infoLines.length = 0
  warnCalls.length = 0
  vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
    infoLines.push(String(args[0]))
  })
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnCalls.push(args)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

/** Todas as linhas que foram para `console.info`, concatenadas. */
function loggedInfo(): string {
  return infoLines.join('\n')
}

describe('screenShare.startAudio (alvo web)', () => {
  it('só vídeo de JANELA: avisa que a transmissão vai sem som', async () => {
    const room = fakeRoom([
      { source: Track.Source.ScreenShare, settings: { displaySurface: 'window' } }
    ])

    await screenShare.startAudio(room)

    expect(loggedInfo()).toContain('VEREDITO no-audio-window')
    expect(loggedInfo()).toContain('hasAudioTrack=false')
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.warning).mock.calls[0][0]).toContain('JANELA')
  })

  it('vídeo + áudio com restrictOwnAudio=true: nenhum toast, mas o log existe', async () => {
    const room = fakeRoom([
      { source: Track.Source.ScreenShare, settings: { displaySurface: 'monitor' } },
      { source: Track.Source.ScreenShareAudio, settings: { restrictOwnAudio: true } }
    ])

    await screenShare.startAudio(room)

    // Quando dá certo ninguém é interrompido por uma boa notícia...
    expect(toast.warning).not.toHaveBeenCalled()
    // ...mas a prova fica registrada, com os três valores que o experimento
    // do eco precisa para ser interpretável.
    expect(loggedInfo()).toContain('VEREDITO audio-protected')
    expect(loggedInfo()).toContain('hasAudioTrack=true')
    expect(loggedInfo()).toContain('displaySurface=monitor')
    expect(loggedInfo()).toContain('restrictOwnAudio=true')
  })

  it('vídeo + áudio com restrictOwnAudio=false: avisa sobre o risco de eco', async () => {
    const room = fakeRoom([
      { source: Track.Source.ScreenShare, settings: { displaySurface: 'monitor' } },
      { source: Track.Source.ScreenShareAudio, settings: { restrictOwnAudio: false } }
    ])

    await screenShare.startAudio(room)

    expect(loggedInfo()).toContain('VEREDITO audio-unprotected')
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.warning).mock.calls[0][0]).toContain('eco')
  })

  it('getSettings() lançando: resolve mesmo assim e não derruba a transmissão', async () => {
    const room = fakeRoom([
      { source: Track.Source.ScreenShare, throwsOnGetSettings: true },
      { source: Track.Source.ScreenShareAudio, throwsOnGetSettings: true }
    ])

    // O contrato é o mesmo do Electron: `startAudio` NUNCA lança. Ler de volta
    // é diagnóstico; um diagnóstico que derruba o compartilhamento que veio
    // diagnosticar seria pior que a doença.
    await expect(screenShare.startAudio(room)).resolves.toBeUndefined()

    // E a falha de LEITURA aparece — senão ela viraria "este navegador não
    // reporta restrictOwnAudio", que é uma acusação falsa ao Chrome.
    expect(warnCalls.length).toBeGreaterThan(0)
    // A faixa de áudio existe mesmo com a leitura falhando: a existência da
    // publicação é o que responde "veio áudio?".
    expect(loggedInfo()).toContain('hasAudioTrack=true')
  })
})

describe('screenShare.captureOptions (alvo web)', () => {
  it('põe restrictOwnAudio DENTRO de audio — o único lugar que o SDK repassa', () => {
    const options = screenShare.captureOptions('detail', true)

    // `screenCaptureToDisplayMediaStreamOptions` (`livekit-client.esm.mjs:
    // 13350-13359`) repassa ao `getDisplayMedia` APENAS `{ audio, video,
    // controller, selfBrowserSurface, surfaceSwitching, systemAudio,
    // preferCurrentTab }`. Tudo que estiver no nível de cima e não estiver
    // nessa lista some — sem erro, sem aviso, sem log.
    expect(options.audio).toEqual({ restrictOwnAudio: true })

    // A caixinha de áudio no diálogo do Chrome só aparece por causa disto.
    expect(options.systemAudio).toBe('include')
    // A própria aba do Hydra fora da lista: compartilhar a si mesmo é o túnel
    // de espelhos.
    expect(options.selfBrowserSurface).toBe('exclude')
    expect(options.surfaceSwitching).toBe('include')
    expect(options.contentHint).toBe('detail')

    // A prova pelo negativo: `suppressLocalAudioPlayback` NÃO está no nível de
    // cima. Se alguém "ligar a opção" ali um dia, este teste é o que diz que o
    // SDK vai descartá-la em silêncio.
    expect(options).not.toHaveProperty('suppressLocalAudioPlayback')
  })
})
