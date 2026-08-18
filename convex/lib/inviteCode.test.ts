import { describe, expect, it, vi } from 'vitest'
import {
  findAvailableInviteCode,
  generateInviteCode,
  INVITE_CODE_DEFAULT_MAX_ATTEMPTS,
} from './inviteCode'

describe('generateInviteCode', () => {
  it('sempre retorna 8 caracteres do alfabeto sem ambiguidade visual (sem 0/O/1/I/L)', () => {
    for (let i = 0; i < 1000; i++) {
      const code = generateInviteCode()
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    }
  })

  it('nunca contém os caracteres banidos (0, O, 1, I — L permanece no alfabeto do plano)', () => {
    for (let i = 0; i < 1000; i++) {
      const code = generateInviteCode()
      expect(code).not.toMatch(/[01IO]/)
    }
  })
})

describe('findAvailableInviteCode', () => {
  it('retorna o primeiro candidato reportado como livre', async () => {
    const code = await findAvailableInviteCode({
      generateCode: () => 'ABCD2345',
      existsFn: () => false,
    })
    expect(code).toBe('ABCD2345')
  })

  it('quando o primeiro candidato colide, tenta de novo até achar um livre', async () => {
    const candidates = ['AAAA2222', 'AAAA2222', 'ZZZZ9999']
    let call = 0
    const taken = new Set(['AAAA2222'])

    const code = await findAvailableInviteCode({
      generateCode: () => candidates[call++],
      existsFn: (candidate) => taken.has(candidate),
    })

    expect(code).toBe('ZZZZ9999')
    expect(call).toBe(3)
  })

  it('esgota exatamente maxAttempts tentativas e lança, sem retornar candidato não confirmado', async () => {
    const existsFn = vi.fn().mockResolvedValue(true)

    await expect(
      findAvailableInviteCode({
        generateCode: () => 'AAAA2222',
        existsFn,
        maxAttempts: INVITE_CODE_DEFAULT_MAX_ATTEMPTS,
      })
    ).rejects.toThrow()

    expect(existsFn).toHaveBeenCalledTimes(INVITE_CODE_DEFAULT_MAX_ATTEMPTS)
  })

  it('respeita um maxAttempts customizado', async () => {
    const existsFn = vi.fn().mockResolvedValue(true)

    await expect(
      findAvailableInviteCode({ generateCode: () => 'AAAA2222', existsFn, maxAttempts: 3 })
    ).rejects.toThrow()

    expect(existsFn).toHaveBeenCalledTimes(3)
  })
})
