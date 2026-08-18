import { describe, expect, it, vi } from 'vitest'
import { findAvailableTag, generateFourDigitTag, TAG_DEFAULT_MAX_ATTEMPTS } from './tag'

describe('generateFourDigitTag', () => {
  it('sempre retorna uma string de 4 dígitos com zero à esquerda quando necessário', () => {
    for (let i = 0; i < 1000; i++) {
      const tag = generateFourDigitTag()
      expect(tag).toMatch(/^\d{4}$/)
    }
  })
})

describe('findAvailableTag', () => {
  it('retorna o primeiro candidato reportado como livre', async () => {
    const tag = await findAvailableTag({
      generateTag: () => '1234',
      existsFn: () => false,
    })
    expect(tag).toBe('1234')
  })

  it('quando o primeiro candidato colide, tenta de novo até achar um livre', async () => {
    const candidates = ['0001', '0001', '4242']
    let call = 0
    const taken = new Set(['0001'])

    const tag = await findAvailableTag({
      generateTag: () => candidates[call++],
      existsFn: (candidate) => taken.has(candidate),
    })

    expect(tag).toBe('4242')
    expect(call).toBe(3)
  })

  it('esgota exatamente maxAttempts tentativas e lança, sem retornar candidato não confirmado', async () => {
    const existsFn = vi.fn().mockResolvedValue(true)

    await expect(
      findAvailableTag({
        generateTag: () => '0000',
        existsFn,
        maxAttempts: TAG_DEFAULT_MAX_ATTEMPTS,
      }),
    ).rejects.toThrow()

    expect(existsFn).toHaveBeenCalledTimes(TAG_DEFAULT_MAX_ATTEMPTS)
  })

  it('respeita um maxAttempts customizado', async () => {
    const existsFn = vi.fn().mockResolvedValue(true)

    await expect(
      findAvailableTag({ generateTag: () => '0000', existsFn, maxAttempts: 3 }),
    ).rejects.toThrow()

    expect(existsFn).toHaveBeenCalledTimes(3)
  })
})
