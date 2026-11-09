import { describe, expect, it } from 'vitest'

import { callStartedAt, formatCallDuration } from './call-timer'

describe('call-timer', () => {
  it('começa na primeira pessoa', () =>
    expect(callStartedAt([{ joinedAt: 5000 }, { joinedAt: 1000 }])).toBe(1000))
  it('call vazia não tem início', () => expect(callStartedAt([])).toBeNull())
  it('formata h:mm:ss', () =>
    expect(formatCallDuration((1 * 3600 + 30 * 60 + 44) * 1000)).toBe('1:30:44'))
  it('abaixo de uma hora', () => expect(formatCallDuration(65_000)).toBe('0:01:05'))
  it('relógio adiantado nunca fica negativo', () =>
    expect(formatCallDuration(-5000)).toBe('0:00:00'))
  it('valor não finito vira zero', () => expect(formatCallDuration(Number.NaN)).toBe('0:00:00'))
})
