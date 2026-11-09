import { describe, expect, it } from 'vitest'
import {
  formatDayLabel,
  formatFullTimestamp,
  formatMessageTimestamp,
  formatShortTime
} from './message-time'

const now = new Date(2026, 10, 9, 10, 0).getTime()

describe('message-time', () => {
  it('hoje', () =>
    expect(formatMessageTimestamp(new Date(2026, 10, 9, 8, 5).getTime(), now)).toBe('Hoje às 08:05'))
  it('ontem', () =>
    expect(formatMessageTimestamp(new Date(2026, 10, 8, 23, 25).getTime(), now)).toBe('Ontem às 23:25'))
  it('dias antigos', () =>
    expect(formatMessageTimestamp(new Date(2026, 10, 7, 23, 25).getTime(), now)).toBe('07/11/2026 23:25'))
  it('ontem atravessando o ano', () =>
    expect(
      formatMessageTimestamp(new Date(2026, 11, 31, 23, 59).getTime(), new Date(2027, 0, 1, 0, 30).getTime())
    ).toBe('Ontem às 23:59'))
  it('data por extenso', () =>
    expect(formatFullTimestamp(new Date(2026, 10, 7, 23, 25).getTime())).toBe(
      'sábado, 7 de novembro de 2026 23:25'
    ))
  it('rótulo do dia', () =>
    expect(formatDayLabel(new Date(2026, 10, 8, 1, 0).getTime())).toBe('8 de novembro de 2026'))
  it('hora curta', () =>
    expect(formatShortTime(new Date(2026, 10, 8, 9, 3).getTime())).toBe('09:03'))
})
