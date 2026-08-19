import { describe, expect, it } from 'vitest'

import {
  addScreenShareEntry,
  clearScreenShareEntries,
  removeScreenShareEntriesOfParticipant,
  removeScreenShareEntryBySid,
  type ScreenShareEntry
} from './screenshare-tracks'

// Track falsa: o módulo é genérico sobre o tipo da track justamente para poder
// ser testado sem `livekit-client` e sem DOM (o ambiente do vitest deste
// projeto é `edge-runtime`). O que importa aqui é a IDENTIDADE do objeto.
type FakeTrack = { id: string }

function entry(
  trackSid: string,
  participantIdentity: string,
  track: FakeTrack,
  isLocal = false
): ScreenShareEntry<FakeTrack> {
  return { trackSid, participantIdentity, isLocal, track }
}

describe('addScreenShareEntry', () => {
  it('adiciona a primeira track de tela', () => {
    const track = { id: 'a' }
    const result = addScreenShareEntry([], entry('TR_1', 'user_a', track))

    expect(result).toHaveLength(1)
    expect(result[0].track).toBe(track)
  })

  it('não duplica quando o mesmo evento chega duas vezes', () => {
    const track = { id: 'a' }
    const first = addScreenShareEntry([], entry('TR_1', 'user_a', track))
    const second = addScreenShareEntry(first, entry('TR_1', 'user_a', track))

    expect(second).toHaveLength(1)
    // Mesma referência: nada mudou, nenhum re-render precisa acontecer.
    expect(second).toBe(first)
  })

  it('substitui a track quando o mesmo sid volta com um objeto NOVO', () => {
    // Re-inscrição depois de reconexão: manter a track antiga deixaria um
    // <video> preso a uma MediaStreamTrack morta — frame congelado.
    const oldTrack = { id: 'velha' }
    const newTrack = { id: 'nova' }
    const before = addScreenShareEntry([], entry('TR_1', 'user_a', oldTrack))
    const after = addScreenShareEntry(before, entry('TR_1', 'user_a', newTrack))

    expect(after).toHaveLength(1)
    expect(after[0].track).toBe(newTrack)
    expect(after).not.toBe(before)
  })

  it('preserva a posição na grade ao substituir', () => {
    const list = [
      entry('TR_1', 'user_a', { id: 'a' }),
      entry('TR_2', 'user_b', { id: 'b' }),
      entry('TR_3', 'user_c', { id: 'c' })
    ]
    const result = addScreenShareEntry(list, entry('TR_2', 'user_b', { id: 'b2' }))

    expect(result.map((e) => e.trackSid)).toEqual(['TR_1', 'TR_2', 'TR_3'])
    expect(result[1].track).toEqual({ id: 'b2' })
  })

  it('mantém telas simultâneas de pessoas diferentes (MVP: grid, sem foco)', () => {
    const a = addScreenShareEntry([], entry('TR_1', 'user_a', { id: 'a' }))
    const both = addScreenShareEntry(a, entry('TR_2', 'user_b', { id: 'b' }))

    expect(both.map((e) => e.participantIdentity)).toEqual(['user_a', 'user_b'])
  })
})

describe('removeScreenShareEntryBySid', () => {
  it('remove a track despublicada — caminho limpo de SHARE-06', () => {
    const list = addScreenShareEntry([], entry('TR_1', 'user_a', { id: 'a' }))
    expect(removeScreenShareEntryBySid(list, 'TR_1')).toEqual([])
  })

  it('é no-op para sid desconhecido (despublicação de câmera/áudio, evento repetido)', () => {
    const list = addScreenShareEntry([], entry('TR_1', 'user_a', { id: 'a' }))
    expect(removeScreenShareEntryBySid(list, 'TR_OUTRA')).toBe(list)
  })

  it('remove só a track certa quando há duas telas no ar', () => {
    const list = [entry('TR_1', 'user_a', { id: 'a' }), entry('TR_2', 'user_b', { id: 'b' })]
    const result = removeScreenShareEntryBySid(list, 'TR_1')

    expect(result.map((e) => e.trackSid)).toEqual(['TR_2'])
  })
})

describe('removeScreenShareEntriesOfParticipant', () => {
  it('remove tudo de quem caiu — caminho SUJO de SHARE-06 (app fechado à força)', () => {
    const list = [
      entry('TR_1', 'apresentador', { id: 'tela' }),
      entry('TR_2', 'apresentador', { id: 'segunda-tela' }),
      entry('TR_3', 'outro', { id: 'outra' })
    ]
    const result = removeScreenShareEntriesOfParticipant(list, 'apresentador')

    expect(result.map((e) => e.trackSid)).toEqual(['TR_3'])
  })

  it('é no-op quando quem saiu não compartilhava nada', () => {
    const list = [entry('TR_1', 'apresentador', { id: 'tela' })]
    expect(removeScreenShareEntriesOfParticipant(list, 'espectador')).toBe(list)
  })
})

describe('clearScreenShareEntries', () => {
  it('zera a lista na desconexão do próprio cliente', () => {
    const list = [entry('TR_1', 'user_a', { id: 'a' })]
    expect(clearScreenShareEntries(list)).toEqual([])
  })

  it('devolve a mesma lista vazia quando já estava vazia', () => {
    const empty: ScreenShareEntry<FakeTrack>[] = []
    expect(clearScreenShareEntries(empty)).toBe(empty)
  })
})
