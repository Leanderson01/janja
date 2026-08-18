import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import type { Id } from './_generated/dataModel'

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

describe('servers.createServer', () => {
  test('rejeita criação sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)

    await expect(
      t.mutation(anyApi.servers.createServer, { name: 'Galera do Sinuca' })
    ).rejects.toThrow()
  })

  test('cria servidor e torna o chamador dono e único membro', async () => {
    const t = convexTest(schema, modules)
    const workosId = 'workos_user_ana'
    await insertUser(t, workosId, 'ana', '0001')
    const asAna = t.withIdentity({ subject: workosId })

    const serverId: Id<'servers'> = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Galera do Sinuca',
    })

    const server = await t.run((ctx) => ctx.db.get(serverId))
    const ana = await t.run((ctx) =>
      ctx.db
        .query('users')
        .withIndex('by_workos_id', (q) => q.eq('workosId', workosId))
        .unique()
    )
    expect(server).not.toBeNull()
    expect(server?.ownerId).toBe(ana?._id)

    const memberships = await t.run((ctx) => ctx.db.query('serverMembers').collect())
    expect(memberships).toHaveLength(1)
    expect(memberships[0].serverId).toBe(serverId)
    expect(memberships[0].userId).toBe(ana?._id)
  })

  test('rejeita nome vazio ou só espaços', async () => {
    const t = convexTest(schema, modules)
    const workosId = 'workos_user_ana'
    await insertUser(t, workosId, 'ana', '0001')
    const asAna = t.withIdentity({ subject: workosId })

    await expect(asAna.mutation(anyApi.servers.createServer, { name: '' })).rejects.toThrow()
    await expect(asAna.mutation(anyApi.servers.createServer, { name: '   ' })).rejects.toThrow()
  })

  test('rejeita nome com mais de 50 caracteres', async () => {
    const t = convexTest(schema, modules)
    const workosId = 'workos_user_ana'
    await insertUser(t, workosId, 'ana', '0001')
    const asAna = t.withIdentity({ subject: workosId })

    const tooLong = 'a'.repeat(51)
    await expect(
      asAna.mutation(anyApi.servers.createServer, { name: tooLong })
    ).rejects.toThrow()
  })
})

describe('servers.listMyServers', () => {
  test('isola servidores por usuário — cada um só vê o que criou', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_user_ana'
    const brunoWorkosId = 'workos_user_bruno'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    await insertUser(t, brunoWorkosId, 'bruno', '0002')

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const asBruno = t.withIdentity({ subject: brunoWorkosId })

    const serverAId = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Servidor A',
    })
    const serverBId = await asBruno.mutation(anyApi.servers.createServer, {
      name: 'Servidor B',
    })

    const anaServers = await asAna.query(anyApi.servers.listMyServers, {})
    const brunoServers = await asBruno.query(anyApi.servers.listMyServers, {})

    expect(anaServers).toHaveLength(1)
    expect(anaServers[0]._id).toBe(serverAId)

    expect(brunoServers).toHaveLength(1)
    expect(brunoServers[0]._id).toBe(serverBId)
  })

  test('rejeita listagem sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)

    await expect(t.query(anyApi.servers.listMyServers, {})).rejects.toThrow()
  })
})

describe('servers.amIOwner', () => {
  test('dono recebe true', async () => {
    const t = convexTest(schema, modules)
    const workosId = 'workos_user_ana'
    await insertUser(t, workosId, 'ana', '0001')
    const asAna = t.withIdentity({ subject: workosId })

    const serverId = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Galera do Sinuca',
    })

    const result = await asAna.query(anyApi.servers.amIOwner, { serverId })
    expect(result).toBe(true)
  })

  test('membro comum (não-dono) recebe false', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_user_ana'
    const brunoWorkosId = 'workos_user_bruno'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const asBruno = t.withIdentity({ subject: brunoWorkosId })

    const serverId = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Galera do Sinuca',
    })

    // Bruno entra como membro comum diretamente via db (ingresso via convite é o plano 04-02).
    await t.run((ctx) =>
      ctx.db.insert('serverMembers', { serverId, userId: brunoId, joinedAt: Date.now() })
    )

    const result = await asBruno.query(anyApi.servers.amIOwner, { serverId })
    expect(result).toBe(false)
  })

  test('rejeita não-membro chamando com serverId de um servidor real', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_user_ana'
    const carlaWorkosId = 'workos_user_carla'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    await insertUser(t, carlaWorkosId, 'carla', '0003')

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    const serverId = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Galera do Sinuca',
    })

    await expect(asCarla.query(anyApi.servers.amIOwner, { serverId })).rejects.toThrow()
  })
})
