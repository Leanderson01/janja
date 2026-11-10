import { describe, expect, it } from 'vitest'

import { VAD_MAX_DB, VAD_SILENCE_DB } from './vad'
import { dbToPercent, formatDb } from './vad-scale'
import { VAD_THRESHOLD_MAX_DB, VAD_THRESHOLD_MIN_DB } from './voice-preferences'

describe('vad-scale', () => {
  it('slider (preferências) e medidor (vad.ts) usam a MESMA faixa', () => {
    // Se uma das pontas mudar sozinha, a marca do limiar descola do polegar.
    expect(VAD_THRESHOLD_MIN_DB).toBe(VAD_SILENCE_DB)
    expect(VAD_THRESHOLD_MAX_DB).toBe(VAD_MAX_DB)
  })

  it('dbToPercent é linear em dB: −100 => 0%, −50 => 50%, 0 => 100%', () => {
    expect(dbToPercent(-100)).toBe(0)
    expect(dbToPercent(-50)).toBe(50)
    expect(dbToPercent(0)).toBe(100)
  })

  it('dbToPercent prende fora da faixa e não devolve NaN', () => {
    expect(dbToPercent(-Infinity)).toBe(0)
    expect(dbToPercent(12)).toBe(100)
    expect(dbToPercent(Number.NaN)).toBe(0)
  })

  it('formatDb: inteiro, menos tipográfico, sem "−0"', () => {
    expect(formatDb(-50)).toBe('−50 dB')
    expect(formatDb(-57.6)).toBe('−58 dB')
    expect(formatDb(-0.4)).toBe('0 dB')
    expect(formatDb(0)).toBe('0 dB')
    expect(formatDb(Number.NaN)).toBe('−100 dB')
  })
})
