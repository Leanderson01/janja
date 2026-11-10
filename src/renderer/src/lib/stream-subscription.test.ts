import { Track } from 'livekit-client'
import { describe, expect, it } from 'vitest'

import {
  publicationsToSubscribe,
  sameMembers,
  screenSharePublicationOf,
  shouldAutoSubscribe,
  shouldSubscribe,
  watchedIdentities,
  withWatched,
  withoutWatched
} from './stream-subscription'

// Publicação e participante falsos: a decisão só lê `identity`, `source`,
// `trackSid` e o mapa de publicações, que é exatamente o formato de
// `room.remoteParticipants`. Cada chamada de `participant()` cria um objeto
// NOVO, como o SDK faz ao recriar os participantes numa reconexão completa.
type FakePublication = { trackSid: string; source: Track.Source }

function participant(
  identity: string,
  publications: FakePublication[]
): { identity: string; trackPublications: Map<string, FakePublication> } {
  return {
    identity,
    trackPublications: new Map(publications.map((pub) => [pub.trackSid, { ...pub }]))
  }
}

const micA = { trackSid: 'TR_micA', source: Track.Source.Microphone }
const screenA1 = { trackSid: 'TR_screenA1', source: Track.Source.ScreenShare }
const screenAudioA1 = { trackSid: 'TR_screenAudioA1', source: Track.Source.ScreenShareAudio }
// A segunda transmissão de A na mesma call: o servidor dá sids novos.
const screenA2 = { trackSid: 'TR_screenA2', source: Track.Source.ScreenShare }
const screenAudioA2 = { trackSid: 'TR_screenAudioA2', source: Track.Source.ScreenShareAudio }
const micB = { trackSid: 'TR_micB', source: Track.Source.Microphone }
const cameraB = { trackSid: 'TR_cameraB', source: Track.Source.Camera }

function sids(publications: FakePublication[]): string[] {
  return publications.map((pub) => pub.trackSid).sort()
}

describe('shouldAutoSubscribe', () => {
  it('mic e câmera continuam automáticos', () => {
    expect(shouldAutoSubscribe(Track.Source.Microphone)).toBe(true)
    expect(shouldAutoSubscribe(Track.Source.Camera)).toBe(true)
  })
  it('tela e som da tela esperam o clique', () => {
    expect(shouldAutoSubscribe(Track.Source.ScreenShare)).toBe(false)
    expect(shouldAutoSubscribe(Track.Source.ScreenShareAudio)).toBe(false)
  })
  it('fonte desconhecida é automática', () =>
    expect(shouldAutoSubscribe(Track.Source.Unknown)).toBe(true))
})

describe('shouldSubscribe', () => {
  it('mic é sempre assinado, com ou sem transmissão assistida', () => {
    const a = participant('A', [micA, screenA1, screenAudioA1])
    expect(shouldSubscribe(micA, a, new Set())).toBe(true)
    expect(shouldSubscribe(micA, a, new Set(['TR_screenA1']))).toBe(true)
    expect(shouldSubscribe(micA, a, new Set(['TR_outra']))).toBe(true)
  })
  it('tela que estou assistindo é assinada, vídeo e som', () => {
    const a = participant('A', [micA, screenA1, screenAudioA1])
    const watched = new Set(['TR_screenA1'])
    expect(shouldSubscribe(screenA1, a, watched)).toBe(true)
    expect(shouldSubscribe(screenAudioA1, a, watched)).toBe(true)
  })
  it('tela que ninguém clicou não é assinada, nem o som', () => {
    const a = participant('A', [micA, screenA1, screenAudioA1])
    expect(shouldSubscribe(screenA1, a, new Set())).toBe(false)
    expect(shouldSubscribe(screenAudioA1, a, new Set())).toBe(false)
  })
  it('som da tela sem o vídeo no ar não é assinado', () => {
    const a = participant('A', [micA, screenAudioA1])
    expect(shouldSubscribe(screenAudioA1, a, new Set(['TR_screenA1']))).toBe(false)
  })
})

describe('A para e volta a transmitir', () => {
  it('B não recebe a transmissão nova sem clicar de novo', () => {
    // B clicou na primeira transmissão de A; A parou e começou outra.
    const watched = new Set(['TR_screenA1'])
    const a = participant('A', [micA, screenA2, screenAudioA2])
    expect(shouldSubscribe(screenA2, a, watched)).toBe(false)
    expect(shouldSubscribe(screenAudioA2, a, watched)).toBe(false)
    expect(sids(publicationsToSubscribe([a], watched))).toEqual(['TR_micA'])
    expect(watchedIdentities([a], watched).size).toBe(0)
  })
})

describe('reconexão completa de B', () => {
  it('quem B assistia continua assistido, vídeo e som', () => {
    const watched = new Set(['TR_screenA1'])
    // O SDK recria os participantes do zero; os sids são de A no servidor.
    const recreated = [participant('A', [micA, screenA1, screenAudioA1]), participant('B', [micB])]
    expect(sids(publicationsToSubscribe(recreated, watched))).toEqual([
      'TR_micA',
      'TR_micB',
      'TR_screenA1',
      'TR_screenAudioA1'
    ])
    expect([...watchedIdentities(recreated, watched)]).toEqual(['A'])
  })
})

describe('publicationsToSubscribe', () => {
  it('sem ninguém assistido, assina todo mic e câmera e nenhuma tela', () => {
    const result = publicationsToSubscribe(
      [participant('A', [micA, screenA1, screenAudioA1]), participant('B', [micB, cameraB])],
      new Set()
    )
    expect(sids(result)).toEqual(['TR_cameraB', 'TR_micA', 'TR_micB'])
  })
  it('assistir a tela de A não puxa a de outra pessoa', () => {
    const c = participant('C', [
      { trackSid: 'TR_micC', source: Track.Source.Microphone },
      { trackSid: 'TR_screenC', source: Track.Source.ScreenShare },
      { trackSid: 'TR_screenAudioC', source: Track.Source.ScreenShareAudio }
    ])
    const result = publicationsToSubscribe(
      [participant('A', [micA, screenA1]), c],
      new Set(['TR_screenA1'])
    )
    expect(sids(result)).toEqual(['TR_micA', 'TR_micC', 'TR_screenA1'])
  })
  it('sala vazia não assina nada', () => {
    expect(publicationsToSubscribe([], new Set(['TR_screenA1']))).toEqual([])
  })
})

describe('watchedIdentities e screenSharePublicationOf', () => {
  it('só quem tem a transmissão assistida no ar aparece', () => {
    const a = participant('A', [micA, screenA1])
    const b = participant('B', [micB])
    expect([...watchedIdentities([a, b], new Set(['TR_screenA1']))]).toEqual(['A'])
    expect(watchedIdentities([a, b], new Set()).size).toBe(0)
  })
  it('acha o vídeo da tela e ignora o som', () => {
    expect(screenSharePublicationOf(participant('A', [screenAudioA1, screenA1]))?.trackSid).toBe(
      'TR_screenA1'
    )
    expect(screenSharePublicationOf(participant('A', [micA, screenAudioA1]))).toBeUndefined()
  })
})

describe('conjuntos', () => {
  it('acrescentar devolve o mesmo conjunto se já estava', () => {
    const empty: ReadonlySet<string> = new Set()
    const watched = withWatched(empty, 'TR_screenA1')
    expect([...watched]).toEqual(['TR_screenA1'])
    expect(empty.size).toBe(0)
    expect(withWatched(watched, 'TR_screenA1')).toBe(watched)
  })
  it('tirar devolve o mesmo conjunto se não estava', () => {
    const watched: ReadonlySet<string> = new Set(['TR_screenA1', 'TR_screenC'])
    const next = withoutWatched(watched, 'TR_screenA1')
    expect([...next]).toEqual(['TR_screenC'])
    expect(watched.has('TR_screenA1')).toBe(true)
    expect(withoutWatched(next, 'TR_screenA1')).toBe(next)
  })
  it('sameMembers compara membros, não identidade', () => {
    expect(sameMembers(new Set(['A', 'B']), new Set(['B', 'A']))).toBe(true)
    expect(sameMembers(new Set(['A']), new Set(['A', 'B']))).toBe(false)
    expect(sameMembers(new Set(['A']), new Set(['B']))).toBe(false)
  })
})
