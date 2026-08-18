import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { describe, expect, it, vi } from 'vitest'
import schema from './schema'
import * as tag from './lib/tag'

const modules = import.meta.glob('./**/*.ts')

describe('users.ensureUser', () => {
  it('rejeita quando não há identidade autenticada', async () => {
    const t = convexTest(schema, modules)

    await expect(t.mutation(anyApi.users.ensureUser, {})).rejects.toThrow()
  })

  it('primeiro login gera um username#tag de 4 dígitos', async () => {
    const t = convexTest(schema, modules)
    const asLeo = t.withIdentity({ subject: 'workos_leo', email: 'leo@example.com' })

    const result = await asLeo.mutation(anyApi.users.ensureUser, {})

    expect(result.username).toBe('leo')
    expect(result.tag).toMatch(/^\d{4}$/)
    expect(result.workosId).toBe('workos_leo')
  })

  it('login repetido com a mesma identidade nunca cria um segundo documento', async () => {
    const t = convexTest(schema, modules)
    const asLeo = t.withIdentity({ subject: 'workos_leo', email: 'leo@example.com' })

    const first = await asLeo.mutation(anyApi.users.ensureUser, {})
    const second = await asLeo.mutation(anyApi.users.ensureUser, {})

    const rows = await t.run((ctx) => ctx.db.query('users').collect())
    expect(rows).toHaveLength(1)
    expect(second.username).toBe(first.username)
    expect(second.tag).toBe(first.tag)
    expect(second._id).toBe(first._id)
  })

  it('colisão de (username, tag) resulta em uma tag diferente, nunca em erro nem duplicata', async () => {
    const t = convexTest(schema, modules)

    await t.run((ctx) =>
      ctx.db.insert('users', {
        workosId: 'workos_other',
        username: 'leo',
        tag: '0001',
        displayName: 'Leo Existente',
      }),
    )

    const spy = vi.spyOn(tag, 'generateFourDigitTag')
    spy.mockReturnValueOnce('0001').mockReturnValueOnce('4242')

    const asLeo = t.withIdentity({ subject: 'workos_leo', email: 'leo@example.com' })
    const result = await asLeo.mutation(anyApi.users.ensureUser, {})

    expect(spy).toHaveBeenCalledTimes(2)
    expect(result.username).toBe('leo')
    expect(result.tag).not.toBe('0001')
    expect(result.tag).toBe('4242')

    const rows = await t.run((ctx) => ctx.db.query('users').collect())
    expect(rows).toHaveLength(2)

    spy.mockRestore()
  })
})
