import { describe, expect, it } from 'vitest'

import { shareSoundEvents, type ShareRow } from './share-sound-events'

// Follow-up 1: som de "transmissão começou"/"terminou" para quem está na call,
// a partir da coluna `sharing` das linhas de `voiceParticipantsByChannel` do
// canal em que estou. Função pura, sem DOM: roda no `edge-runtime`.

function rows(...entries: Array<[string, boolean]>): ShareRow[] {
  return entries.map(([userId, sharing]) => ({ userId, sharing }))
}

describe('shareSoundEvents', () => {
  it('alguém começa a compartilhar → start', () => {
    expect(
      shareSoundEvents(rows(['ana', false], ['bia', false]), rows(['ana', true], ['bia', false]))
    ).toEqual(['start'])
  })

  it('alguém para de compartilhar → stop', () => {
    expect(
      shareSoundEvents(rows(['ana', true], ['bia', false]), rows(['ana', false], ['bia', false]))
    ).toEqual(['stop'])
  })

  it('snapshot inicial (ao entrar) não toca nada, nem para quem já compartilhava', () => {
    expect(shareSoundEvents(null, rows(['ana', true], ['bia', false]))).toEqual([])
  })

  it('quem sai da call compartilhando não gera stop (sair já tem o som de saída)', () => {
    expect(shareSoundEvents(rows(['ana', true], ['bia', false]), rows(['bia', false]))).toEqual([])
  })

  it('quem chega não gera som de transmissão (entrar já tem o som de entrada)', () => {
    expect(shareSoundEvents(rows(['ana', false]), rows(['ana', false], ['bia', true]))).toEqual([])
  })

  it('duas pessoas ao mesmo tempo → um evento para cada', () => {
    expect(
      shareSoundEvents(rows(['ana', false], ['bia', false]), rows(['ana', true], ['bia', true]))
    ).toEqual(['start', 'start'])
    expect(
      shareSoundEvents(
        rows(['ana', true], ['bia', false]),
        rows(['ana', false], ['bia', true])
      ).sort()
    ).toEqual(['start', 'stop'])
  })

  it('nada mudou → nada toca', () => {
    expect(
      shareSoundEvents(rows(['ana', true], ['bia', false]), rows(['bia', false], ['ana', true]))
    ).toEqual([])
  })
})
