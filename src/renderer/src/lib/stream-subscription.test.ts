import { Track } from 'livekit-client'
import { describe, expect, it } from 'vitest'

import {
  consumePendingWatch,
  consumePendingWatchInRoom,
  createPendingWatch,
  keepPendingWatchFor,
  PENDING_WATCH_TTL_MS,
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

// Follow-up 1: "Assistir transmissão" pelo AO VIVO da lista de canais, que pode
// chegar ANTES da publicação na sala (o clique que entra na call, ou o Convex
// chegando antes do LiveKit). A intenção é de UM uso: vale para a primeira
// transmissão da pessoa que aparecer, e só para ela.
describe('intenção pendente de assistir', () => {
  const T0 = 1_000_000
  const CALL = 'ch_voz'
  const pendingA = createPendingWatch('A', CALL, T0)
  const screenAudioA = { trackSid: 'TR_screenAudioA1', source: Track.Source.ScreenShareAudio }

  it('nasce com prazo', () => {
    expect(pendingA).toEqual({
      identity: 'A',
      channelId: CALL,
      expiresAt: T0 + PENDING_WATCH_TTL_MS
    })
  })

  it('consome na primeira transmissão (vídeo da tela) da pessoa certa', () => {
    const a = participant('A', [micA, screenA1])
    expect(consumePendingWatch(pendingA, screenA1, a, T0 + 10)).toEqual({
      watchSid: 'TR_screenA1',
      pending: null
    })
  })

  it('ignora a transmissão de outra pessoa', () => {
    const c = participant('C', [{ trackSid: 'TR_screenC', source: Track.Source.ScreenShare }])
    const result = consumePendingWatch(
      pendingA,
      { trackSid: 'TR_screenC', source: Track.Source.ScreenShare },
      c,
      T0 + 10
    )
    expect(result.watchSid).toBeNull()
    expect(result.pending).toBe(pendingA)
  })

  it('ignora o mic (e o som da tela) da pessoa certa', () => {
    const a = participant('A', [micA, screenAudioA])
    for (const publication of [micA, screenAudioA]) {
      const result = consumePendingWatch(pendingA, publication, a, T0 + 10)
      expect(result.watchSid).toBeNull()
      expect(result.pending).toBe(pendingA)
    }
  })

  it('depois de consumida não vale para a próxima transmissão da pessoa', () => {
    const primeira = consumePendingWatch(pendingA, screenA1, participant('A', [screenA1]), T0 + 10)
    expect(primeira.watchSid).toBe('TR_screenA1')

    // A parou e voltou a transmitir: sid novo, e a intenção já foi usada.
    const a2 = participant('A', [micA, screenA2, screenAudioA2])
    const segunda = consumePendingWatch(primeira.pending, screenA2, a2, T0 + 20)
    expect(segunda).toEqual({ watchSid: null, pending: null })

    // E a regra de assinatura de sempre continua: a nova espera outro clique.
    const watched = new Set([primeira.watchSid as string])
    expect(shouldSubscribe(screenA2, a2, watched)).toBe(false)
    expect(shouldSubscribe(screenAudioA2, a2, watched)).toBe(false)
  })

  it('vencida, é descartada sem assistir nada', () => {
    const a = participant('A', [screenA1])
    expect(consumePendingWatch(pendingA, screenA1, a, T0 + PENDING_WATCH_TTL_MS + 1)).toEqual({
      watchSid: null,
      pending: null
    })
  })

  it('sem intenção, nada acontece', () => {
    const a = participant('A', [screenA1])
    expect(consumePendingWatch(null, screenA1, a, T0)).toEqual({ watchSid: null, pending: null })
  })

  it('a passada pela sala acha a transmissão da pessoa certa entre várias', () => {
    const c = participant('C', [{ trackSid: 'TR_screenC', source: Track.Source.ScreenShare }])
    const a = participant('A', [micA, screenAudioA, screenA1])
    expect(consumePendingWatchInRoom(pendingA, [c, participant('B', [micB]), a], T0 + 10)).toEqual({
      watchSid: 'TR_screenA1',
      pending: null
    })
  })

  it('a passada pela sala guarda a intenção enquanto a transmissão não chegou', () => {
    const result = consumePendingWatchInRoom(
      pendingA,
      [participant('A', [micA]), participant('B', [micB])],
      T0 + 10
    )
    expect(result.watchSid).toBeNull()
    expect(result.pending).toBe(pendingA)
  })

  it('a passada pela sala descarta a intenção vencida', () => {
    expect(
      consumePendingWatchInRoom(
        pendingA,
        [participant('A', [screenA1])],
        T0 + PENDING_WATCH_TTL_MS + 1
      )
    ).toEqual({ watchSid: null, pending: null })
  })

  it('consumir a intenção nunca tira o mic de ninguém da assinatura', () => {
    const room = [participant('A', [micA, screenA1, screenAudioA1]), participant('B', [micB])]
    const { watchSid } = consumePendingWatchInRoom(pendingA, room, T0 + 10)
    const watched = new Set([watchSid as string])
    expect(sids(publicationsToSubscribe(room, watched))).toEqual([
      'TR_micA',
      'TR_micB',
      'TR_screenA1',
      'TR_screenAudioA1'
    ])
  })

  it('só sobrevive a uma troca de call se for da call de destino', () => {
    expect(keepPendingWatchFor(pendingA, CALL)).toBe(pendingA)
    expect(keepPendingWatchFor(pendingA, 'ch_outra')).toBeNull()
    expect(keepPendingWatchFor(pendingA, null)).toBeNull()
    expect(keepPendingWatchFor(null, CALL)).toBeNull()
  })
})
