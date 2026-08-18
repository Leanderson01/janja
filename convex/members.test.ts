import { convexTest } from 'convex-test'
import { anyApi } from 'convex/server'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { isOnline } from './members'
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

describe('members.isOnline', () => {
  test('undefined lastSeen (nunca deu heartbeat) é sempre offline', () => {
    expect(isOnline(undefined, Date.now())).toBe(false)
  })

  test('lastSeen exatamente no limiar (90000ms atrás) é online', () => {
    const now = Date.now()
    expect(isOnline(now - 90_000, now)).toBe(true)
  })

  test('lastSeen 90001ms atrás é offline', () => {
    const now = Date.now()
    expect(isOnline(now - 90_001, now)).toBe(false)
  })

  test('lastSeen no mesmo instante de now é online', () => {
    const now = Date.now()
    expect(isOnline(now, now)).toBe(true)
  })

  test('lastSeen no futuro (relógio local adiantado) é online', () => {
    const now = Date.now()
    expect(isOnline(now + 5000, now)).toBe(true)
  })
})

describe('members.listServerMembers', () => {
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

    await expect(
      asCarla.query(anyApi.members.listServerMembers, { serverId })
    ).rejects.toThrow()
  })

  test('rejeita chamada sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_user_ana'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    const asAna = t.withIdentity({ subject: anaWorkosId })

    const serverId = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Galera do Sinuca',
    })

    await expect(t.query(anyApi.members.listServerMembers, { serverId })).rejects.toThrow()
  })

  test('retorna 3 membros com online derivado de presence (recente/antiga/ausente)', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_user_ana'
    const brunoWorkosId = 'workos_user_bruno'
    const carlaWorkosId = 'workos_user_carla'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')
    const carlaId = await insertUser(t, carlaWorkosId, 'carla', '0003')

    const asAna = t.withIdentity({ subject: anaWorkosId })

    const serverId: Id<'servers'> = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Galera do Sinuca',
    })

    await t.run((ctx) =>
      ctx.db.insert('serverMembers', { serverId, userId: brunoId, joinedAt: Date.now() })
    )
    await t.run((ctx) =>
      ctx.db.insert('serverMembers', { serverId, userId: carlaId, joinedAt: Date.now() })
    )

    // Ana: presença recente (online).
    const ana = await t.run((ctx) =>
      ctx.db
        .query('users')
        .withIndex('by_workos_id', (q) => q.eq('workosId', anaWorkosId))
        .unique()
    )
    await t.run((ctx) =>
      ctx.db.insert('presence', { userId: ana!._id, lastSeen: Date.now() - 1000 })
    )
    // Bruno: presença antiga (offline).
    await t.run((ctx) =>
      ctx.db.insert('presence', { userId: brunoId, lastSeen: Date.now() - 200_000 })
    )
    // Carla: sem linha de presence nenhuma (offline).

    const members = await asAna.query(anyApi.members.listServerMembers, { serverId })

    expect(members).toHaveLength(3)

    type MemberRow = { userId: Id<'users'>; online: boolean; avatarUrl?: string; nickname?: string }
    const byUserId = new Map<Id<'users'>, MemberRow>(
      members.map((m: MemberRow): [Id<'users'>, MemberRow] => [m.userId, m])
    )
    expect(byUserId.get(ana!._id)?.online).toBe(true)
    expect(byUserId.get(brunoId)?.online).toBe(false)
    expect(byUserId.get(carlaId)?.online).toBe(false)

    for (const m of members) {
      expect(m).not.toHaveProperty('workosId')
      expect(m).toHaveProperty('username')
      expect(m).toHaveProperty('tag')
      expect(m).toHaveProperty('displayName')
      // avatarUrl/nickname são opcionais — convex-test omite chaves undefined ao
      // serializar, então checamos apenas que, se presente, é string (nunca o doc bruto).
      if ('avatarUrl' in m) expect(typeof m.avatarUrl).toBe('string')
      if ('nickname' in m) expect(typeof m.nickname).toBe('string')
    }
  })

  test('membro de dois servidores só vê membros do servidor pedido', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_user_ana'
    const brunoWorkosId = 'workos_user_bruno'
    await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const asBruno = t.withIdentity({ subject: brunoWorkosId })

    const serverAId = await asAna.mutation(anyApi.servers.createServer, {
      name: 'Servidor A',
    })
    const serverBId = await asBruno.mutation(anyApi.servers.createServer, {
      name: 'Servidor B',
    })

    // Ana também entra no servidor B, então participa de ambos.
    const ana = await t.run((ctx) =>
      ctx.db
        .query('users')
        .withIndex('by_workos_id', (q) => q.eq('workosId', anaWorkosId))
        .unique()
    )
    await t.run((ctx) =>
      ctx.db.insert('serverMembers', { serverId: serverBId, userId: ana!._id, joinedAt: Date.now() })
    )

    const membersA = await asAna.query(anyApi.members.listServerMembers, {
      serverId: serverAId,
    })
    const membersB = await asAna.query(anyApi.members.listServerMembers, {
      serverId: serverBId,
    })

    expect(membersA).toHaveLength(1)
    expect(membersA[0].userId).toBe(ana!._id)

    expect(membersB).toHaveLength(2)
    const membersBIds = membersB.map((m: { userId: Id<'users'> }) => m.userId).sort()
    expect(membersBIds).toEqual([ana!._id, brunoId].sort())
  })
})
