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

describe('invites.generateInvite', () => {
  test('rejeita não-dono, mesmo sendo membro', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_user_ana'
    const brunoWorkosId = 'workos_user_bruno'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const asBruno = t.withIdentity({ subject: brunoWorkosId })

    const serverId: Id<'servers'> = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Galera do Sinuca',
    })
    await t.run((ctx) =>
      ctx.db.insert('serverMembers', { serverId, userId: brunoId, joinedAt: Date.now() })
    )

    await expect(
      asBruno.mutation(anyApi.invites.generateInvite, { serverId })
    ).rejects.toThrow()
  })

  test('rejeita dono de outro servidor', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_user_ana'
    const carlaWorkosId = 'workos_user_carla'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    await insertUser(t, carlaWorkosId, 'carla', '0003')

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    const serverAId: Id<'servers'> = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Servidor da Ana',
    })
    await asCarla.mutation(anyApi.servers.createServer, { name: 'Servidor da Carla' })

    // Carla não é sequer membro do servidor da Ana — rejeita já em requireMembership.
    await expect(
      asCarla.mutation(anyApi.invites.generateInvite, { serverId: serverAId })
    ).rejects.toThrow()
  })

  test('idempotente: duas chamadas seguidas do dono retornam o mesmo código e criam só um convite', async () => {
    const t = convexTest(schema, modules)
    const workosId = 'workos_user_ana'
    await insertUser(t, workosId, 'ana', '0001')
    const asAna = t.withIdentity({ subject: workosId })

    const serverId: Id<'servers'> = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Galera do Sinuca',
    })

    const firstCode = await asAna.mutation(anyApi.invites.generateInvite, { serverId })
    const secondCode = await asAna.mutation(anyApi.invites.generateInvite, { serverId })

    expect(secondCode).toBe(firstCode)
    const invites = await t.run((ctx) => ctx.db.query('invites').collect())
    expect(invites).toHaveLength(1)
  })

  test('depois de revogar, uma nova chamada gera um código diferente do revogado', async () => {
    const t = convexTest(schema, modules)
    const workosId = 'workos_user_ana'
    await insertUser(t, workosId, 'ana', '0001')
    const asAna = t.withIdentity({ subject: workosId })

    const serverId: Id<'servers'> = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Galera do Sinuca',
    })

    const firstCode = await asAna.mutation(anyApi.invites.generateInvite, { serverId })
    await asAna.mutation(anyApi.invites.revokeInvite, { serverId })
    const secondCode = await asAna.mutation(anyApi.invites.generateInvite, { serverId })

    expect(secondCode).not.toBe(firstCode)
    const invites = await t.run((ctx) => ctx.db.query('invites').collect())
    expect(invites).toHaveLength(2)
  })
})

describe('invites.revokeInvite', () => {
  test('rejeita não-dono, mesmo sendo membro', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_user_ana'
    const brunoWorkosId = 'workos_user_bruno'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const asBruno = t.withIdentity({ subject: brunoWorkosId })

    const serverId: Id<'servers'> = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Galera do Sinuca',
    })
    await t.run((ctx) =>
      ctx.db.insert('serverMembers', { serverId, userId: brunoId, joinedAt: Date.now() })
    )
    await asAna.mutation(anyApi.invites.generateInvite, { serverId })

    await expect(
      asBruno.mutation(anyApi.invites.revokeInvite, { serverId })
    ).rejects.toThrow()
  })

  test('no-op silencioso quando não há convite ativo', async () => {
    const t = convexTest(schema, modules)
    const workosId = 'workos_user_ana'
    await insertUser(t, workosId, 'ana', '0001')
    const asAna = t.withIdentity({ subject: workosId })

    const serverId: Id<'servers'> = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Galera do Sinuca',
    })

    await expect(
      asAna.mutation(anyApi.invites.revokeInvite, { serverId })
    ).resolves.not.toThrow()
  })

  test('código revogado nunca mais permite ingresso, mas quem já entrou continua membro', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_user_ana'
    const brunoWorkosId = 'workos_user_bruno'
    const carlaWorkosId = 'workos_user_carla'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    await insertUser(t, brunoWorkosId, 'bruno', '0002')
    await insertUser(t, carlaWorkosId, 'carla', '0003')

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const asBruno = t.withIdentity({ subject: brunoWorkosId })
    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    const serverId: Id<'servers'> = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Galera do Sinuca',
    })
    const code = await asAna.mutation(anyApi.invites.generateInvite, { serverId })

    // Bruno entra antes da revogação.
    await asBruno.mutation(anyApi.invites.joinByCode, { code })

    await asAna.mutation(anyApi.invites.revokeInvite, { serverId })

    // Carla tenta entrar depois da revogação — rejeita.
    await expect(asCarla.mutation(anyApi.invites.joinByCode, { code })).rejects.toThrow()

    // Bruno, que já tinha entrado antes, continua membro.
    const memberships = await t.run((ctx) => ctx.db.query('serverMembers').collect())
    const brunoUser = await t.run((ctx) =>
      ctx.db
        .query('users')
        .withIndex('by_workos_id', (q) => q.eq('workosId', brunoWorkosId))
        .unique()
    )
    expect(memberships.some((m) => m.userId === brunoUser?._id)).toBe(true)
  })
})

describe('invites.joinByCode', () => {
  test('rejeita código inexistente', async () => {
    const t = convexTest(schema, modules)
    const workosId = 'workos_user_ana'
    await insertUser(t, workosId, 'ana', '0001')
    const asAna = t.withIdentity({ subject: workosId })

    await expect(
      asAna.mutation(anyApi.invites.joinByCode, { code: 'AAAAAAAA' })
    ).rejects.toThrow()
  })

  test('rejeita sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)

    await expect(
      t.mutation(anyApi.invites.joinByCode, { code: 'AAAAAAAA' })
    ).rejects.toThrow()
  })

  test('código válido insere serverMembers e retorna serverId; idempotente na segunda chamada', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_user_ana'
    const brunoWorkosId = 'workos_user_bruno'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    await insertUser(t, brunoWorkosId, 'bruno', '0002')

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const asBruno = t.withIdentity({ subject: brunoWorkosId })

    const serverId: Id<'servers'> = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Galera do Sinuca',
    })
    const code = await asAna.mutation(anyApi.invites.generateInvite, { serverId })

    const returnedServerId = await asBruno.mutation(anyApi.invites.joinByCode, { code })
    expect(returnedServerId).toBe(serverId)

    const membershipsAfterFirst = await t.run((ctx) => ctx.db.query('serverMembers').collect())
    expect(membershipsAfterFirst).toHaveLength(2) // ana (dona) + bruno

    const returnedServerIdAgain = await asBruno.mutation(anyApi.invites.joinByCode, { code })
    expect(returnedServerIdAgain).toBe(serverId)

    const membershipsAfterSecond = await t.run((ctx) => ctx.db.query('serverMembers').collect())
    expect(membershipsAfterSecond).toHaveLength(2)
  })
})

describe('invites.getActiveInvite', () => {
  test('rejeita não-membro', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_user_ana'
    const carlaWorkosId = 'workos_user_carla'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    await insertUser(t, carlaWorkosId, 'carla', '0003')

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    const serverId: Id<'servers'> = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Galera do Sinuca',
    })

    await expect(
      asCarla.query(anyApi.invites.getActiveInvite, { serverId })
    ).rejects.toThrow()
  })

  test('membro comum (não-dono) consegue ler o convite ativo', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_user_ana'
    const brunoWorkosId = 'workos_user_bruno'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const asBruno = t.withIdentity({ subject: brunoWorkosId })

    const serverId: Id<'servers'> = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Galera do Sinuca',
    })
    await t.run((ctx) =>
      ctx.db.insert('serverMembers', { serverId, userId: brunoId, joinedAt: Date.now() })
    )
    const code = await asAna.mutation(anyApi.invites.generateInvite, { serverId })

    const invite = await asBruno.query(anyApi.invites.getActiveInvite, { serverId })
    expect(invite?.code).toBe(code)
  })

  test('retorna null quando não há convite ativo', async () => {
    const t = convexTest(schema, modules)
    const workosId = 'workos_user_ana'
    await insertUser(t, workosId, 'ana', '0001')
    const asAna = t.withIdentity({ subject: workosId })

    const serverId: Id<'servers'> = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Galera do Sinuca',
    })

    const invite = await asAna.query(anyApi.invites.getActiveInvite, { serverId })
    expect(invite).toBeNull()
  })
})
