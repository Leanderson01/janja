import { describe, expect, it } from 'vitest'
import { parseUserTag } from './user-tag'

describe('parseUserTag', () => {
  it('aceita "leo#0001" e retorna username/tag normalizados', () => {
    expect(parseUserTag('leo#0001')).toEqual({ username: 'leo', tag: '0001' })
  })
  it('normaliza maiúsculas e espaços nas bordas', () => {
    expect(parseUserTag('  Leo#0001  ')).toEqual({ username: 'leo', tag: '0001' })
  })
  it('rejeita sem "#"', () => {
    expect(parseUserTag('leo0001')).toBeNull()
  })
  it('rejeita tag com menos de 4 dígitos', () => {
    expect(parseUserTag('leo#1')).toBeNull()
  })
  it('rejeita tag não-numérica', () => {
    expect(parseUserTag('leo#abcd')).toBeNull()
  })
  it('rejeita username vazio', () => {
    expect(parseUserTag('#0001')).toBeNull()
  })
})
