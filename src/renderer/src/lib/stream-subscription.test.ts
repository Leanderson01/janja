import { Track } from 'livekit-client'
import { describe, expect, it } from 'vitest'

import {
  publicationsToSubscribe,
  shouldAutoSubscribe,
  shouldSubscribe,
  withWatched,
  withoutWatched
} from './stream-subscription'

// Publicação e participante falsos: a passada só lê `identity`, `source` e o
// mapa de publicações, que é exatamente o formato de `room.remoteParticipants`.
type FakePublication = { trackSid: string; source: Track.Source }

function participant(
  identity: string,
  publications: FakePublication[]
): { identity: string; trackPublications: Map<string, FakePublication> } {
  return {
    identity,
    trackPublications: new Map(publications.map((pub) => [pub.trackSid, pub]))
  }
}

const micA = { trackSid: 'TR_micA', source: Track.Source.Microphone }
const screenA = { trackSid: 'TR_screenA', source: Track.Source.ScreenShare }
const screenAudioA = { trackSid: 'TR_screenAudioA', source: Track.Source.ScreenShareAudio }
const micB = { trackSid: 'TR_micB', source: Track.Source.Microphone }
const cameraB = { trackSid: 'TR_cameraB', source: Track.Source.Camera }

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
  it('tela de quem estou assistindo é assinada, vídeo e som', () => {
    const watched = new Set(['A'])
    expect(shouldSubscribe(Track.Source.ScreenShare, 'A', watched)).toBe(true)
    expect(shouldSubscribe(Track.Source.ScreenShareAudio, 'A', watched)).toBe(true)
  })
  it('tela de quem não estou assistindo não é assinada', () => {
    const watched = new Set(['A'])
    expect(shouldSubscribe(Track.Source.ScreenShare, 'B', watched)).toBe(false)
    expect(shouldSubscribe(Track.Source.ScreenShareAudio, 'B', watched)).toBe(false)
  })
  it('mic é assinado com ou sem transmissão assistida', () => {
    expect(shouldSubscribe(Track.Source.Microphone, 'A', new Set())).toBe(true)
    expect(shouldSubscribe(Track.Source.Microphone, 'A', new Set(['A']))).toBe(true)
  })
})

describe('publicationsToSubscribe', () => {
  it('sem ninguém assistido, assina todo mic e câmera e nenhuma tela', () => {
    const result = publicationsToSubscribe(
      [participant('A', [micA, screenA, screenAudioA]), participant('B', [micB, cameraB])],
      new Set()
    )
    expect(result.map((pub) => pub.trackSid).sort()).toEqual(['TR_cameraB', 'TR_micA', 'TR_micB'])
  })
  it('com A assistido, assina também o vídeo e o som da tela de A', () => {
    const result = publicationsToSubscribe(
      [participant('A', [micA, screenA, screenAudioA]), participant('B', [micB])],
      new Set(['A'])
    )
    expect(result.map((pub) => pub.trackSid).sort()).toEqual([
      'TR_micA',
      'TR_micB',
      'TR_screenA',
      'TR_screenAudioA'
    ])
  })
  it('assistir B não puxa a tela de A', () => {
    const result = publicationsToSubscribe(
      [participant('A', [micA, screenA, screenAudioA])],
      new Set(['B'])
    )
    expect(result).toEqual([micA])
  })
  it('sala vazia não assina nada', () => {
    expect(publicationsToSubscribe([], new Set(['A']))).toEqual([])
  })
})

describe('conjunto de transmissões assistidas', () => {
  it('assistir acrescenta e devolve o mesmo conjunto se já estava', () => {
    const empty: ReadonlySet<string> = new Set()
    const watched = withWatched(empty, 'A')
    expect([...watched]).toEqual(['A'])
    expect(empty.size).toBe(0)
    expect(withWatched(watched, 'A')).toBe(watched)
  })
  it('parar de assistir tira e devolve o mesmo conjunto se não estava', () => {
    const watched: ReadonlySet<string> = new Set(['A', 'B'])
    const next = withoutWatched(watched, 'A')
    expect([...next]).toEqual(['B'])
    expect(watched.has('A')).toBe(true)
    expect(withoutWatched(next, 'A')).toBe(next)
  })
})
