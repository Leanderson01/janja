import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import type { Doc, Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')

async function insertUser(
  t: ReturnType<typeof convexTest>,
  workosId: string,
  username: string,
  tag: string
) {
  return t.run((ctx) =>
    ctx.db.insert('users', {
      workosId,
      username,
      tag,
      displayName: username,
    })
  )
}

async function insertServerWithChannel(
  t: ReturnType<typeof convexTest>,
  ownerId: Id<'users'>,
  channelType: 'text' | 'voice' = 'text'
) {
  const serverId = await t.run((ctx) =>
    ctx.db.insert('servers', { name: 'Galera do Sinuca', ownerId })
  )
  await t.run((ctx) =>
    ctx.db.insert('serverMembers', { serverId, userId: ownerId, joinedAt: Date.now() })
  )
  const channelId = await t.run((ctx) =>
    ctx.db.insert('channels', { serverId, name: 'geral', type: channelType, position: 0 })
  )
  return { serverId, channelId }
}

async function addMember(t: ReturnType<typeof convexTest>, serverId: Id<'servers'>, userId: Id<'users'>) {
  return t.run((ctx) => ctx.db.insert('serverMembers', { serverId, userId, joinedAt: Date.now() }))
}

describe('typing.setTyping', () => {
  test('membro válido registra "digitando" — insere uma linha em typing', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await asAna.mutation(anyApi.typing.setTyping, { channelId })

    const rows: Doc<'typing'>[] = await t.run((ctx) => ctx.db.query('typing').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0].channelId).toBe(channelId)
    expect(rows[0].userId).toBe(anaId)
  })

  test('chamar setTyping duas vezes seguidas nunca duplica a linha, e updatedAt avança', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await asAna.mutation(anyApi.typing.setTyping, { channelId })
    const firstRows = await t.run((ctx) => ctx.db.query('typing').collect())
    expect(firstRows).toHaveLength(1)
    const firstUpdatedAt = firstRows[0].updatedAt

    // Garante que Date.now() avança pelo menos 1ms entre as duas chamadas.
    await new Promise((resolve) => setTimeout(resolve, 5))

    await asAna.mutation(anyApi.typing.setTyping, { channelId })
    const secondRows = await t.run((ctx) => ctx.db.query('typing').collect())
    expect(secondRows).toHaveLength(1)
    expect(secondRows[0]._id).toBe(firstRows[0]._id)
    expect(secondRows[0].updatedAt).toBeGreaterThan(firstUpdatedAt)
  })

  test('SRV-06 aplicado a digitando: não-membro do servidor não consegue registrar "digitando"', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const carlaWorkosId = 'workos_carla'
    await insertUser(t, carlaWorkosId, 'carla', '0003')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    await expect(
      asCarla.mutation(anyApi.typing.setTyping, { channelId })
    ).rejects.toThrow()

    const rows = await t.run((ctx) => ctx.db.query('typing').collect())
    expect(rows).toHaveLength(0)
  })

  test('rejeita chamada sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)

    await expect(t.mutation(anyApi.typing.setTyping, { channelId })).rejects.toThrow()

    const rows = await t.run((ctx) => ctx.db.query('typing').collect())
    expect(rows).toHaveLength(0)
  })
})

describe('typing.listTyping', () => {
  test('SRV-06 aplicado a digitando: não-membro não consegue listar quem está digitando', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const carlaWorkosId = 'workos_carla'
    await insertUser(t, carlaWorkosId, 'carla', '0003')
    const { channelId } = await insertServerWithChannel(t, anaId)
    await t.run((ctx) =>
      ctx.db.insert('typing', { channelId, userId: anaId, updatedAt: Date.now() })
    )
    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    await expect(
      asCarla.query(anyApi.typing.listTyping, { channelId })
    ).rejects.toThrow()
  })

  test('exclui a própria linha do chamador: Ana e Bruno digitam, cada um vê só o outro', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const brunoWorkosId = 'workos_bruno'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')
    const { serverId, channelId } = await insertServerWithChannel(t, anaId)
    await addMember(t, serverId, brunoId)

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const asBruno = t.withIdentity({ subject: brunoWorkosId })

    await asAna.mutation(anyApi.typing.setTyping, { channelId })
    await asBruno.mutation(anyApi.typing.setTyping, { channelId })

    const anaView = await asAna.query(anyApi.typing.listTyping, { channelId })
    const brunoView = await asBruno.query(anyApi.typing.listTyping, { channelId })

    expect(anaView).toHaveLength(1)
    expect(anaView[0].userId).toBe(brunoId)
    expect(brunoView).toHaveLength(1)
    expect(brunoView[0].userId).toBe(anaId)
  })

  test('junta username/displayName do autor sem vazar workosId', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const brunoWorkosId = 'workos_bruno'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')
    const { serverId, channelId } = await insertServerWithChannel(t, anaId)
    await addMember(t, serverId, brunoId)

    const asBruno = t.withIdentity({ subject: brunoWorkosId })
    await asBruno.mutation(anyApi.typing.setTyping, { channelId })

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const anaView = await asAna.query(anyApi.typing.listTyping, { channelId })

    expect(anaView).toHaveLength(1)
    expect(anaView[0].userId).toBe(brunoId)
    expect(anaView[0].username).toBe('bruno')
    expect(anaView[0].displayName).toBe('bruno')
    expect(anaView[0]).not.toHaveProperty('workosId')
    expect(anaView[0]).toHaveProperty('updatedAt')
  })

  test('linha antiga (updatedAt de minutos atrás) ainda aparece — este arquivo não filtra por idade', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const brunoWorkosId = 'workos_bruno'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')
    const { serverId, channelId } = await insertServerWithChannel(t, anaId)
    await addMember(t, serverId, brunoId)

    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
    await t.run((ctx) =>
      ctx.db.insert('typing', { channelId, userId: brunoId, updatedAt: fiveMinutesAgo })
    )

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const anaView = await asAna.query(anyApi.typing.listTyping, { channelId })

    expect(anaView).toHaveLength(1)
    expect(anaView[0].userId).toBe(brunoId)
    expect(anaView[0].updatedAt).toBe(fiveMinutesAgo)
  })
})
