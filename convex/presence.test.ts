import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { describe, expect, test } from 'vitest'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

describe('presence.heartbeat', () => {
  test('rejeita heartbeat sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)

    await expect(t.mutation(anyApi.presence.heartbeat, {})).rejects.toThrow()
  })

  test('rejeita heartbeat de uma identidade sem usuário correspondente', async () => {
    const t = convexTest(schema, modules)

    const asUnknown = t.withIdentity({ subject: 'workos_user_sem_doc' })

    await expect(asUnknown.mutation(anyApi.presence.heartbeat, {})).rejects.toThrow()

    const rows = await t.run((ctx) => ctx.db.query('presence').collect())
    expect(rows).toHaveLength(0)
  })

  test('upsert: heartbeats repetidos atualizam a mesma linha, sem duplicar', async () => {
    const t = convexTest(schema, modules)

    const workosId = 'workos_user_123'
    await t.run((ctx) =>
      ctx.db.insert('users', {
        workosId,
        username: 'ana',
        tag: '0001',
        displayName: 'Ana',
      })
    )

    const asAna = t.withIdentity({ subject: workosId })

    await asAna.mutation(anyApi.presence.heartbeat, {})
    const afterFirst = await t.run((ctx) => ctx.db.query('presence').collect())
    expect(afterFirst).toHaveLength(1)
    const firstLastSeen = afterFirst[0].lastSeen

    // Garante que o segundo heartbeat produz um timestamp estritamente maior,
    // mesmo em execução rápida do teste.
    await new Promise((resolve) => setTimeout(resolve, 5))

    await asAna.mutation(anyApi.presence.heartbeat, {})
    const afterSecond = await t.run((ctx) => ctx.db.query('presence').collect())

    expect(afterSecond).toHaveLength(1)
    expect(afterSecond[0]._id).toBe(afterFirst[0]._id)
    expect(afterSecond[0].lastSeen).toBeGreaterThan(firstLastSeen)
  })
})
