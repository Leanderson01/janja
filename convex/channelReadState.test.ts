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

async function insertMessage(
  t: ReturnType<typeof convexTest>,
  channelId: Id<'channels'>,
  authorId: Id<'users'>,
  content: string,
  createdAt: number
) {
  return t.run((ctx) => ctx.db.insert('messages', { channelId, authorId, content, createdAt }))
}

describe('channelReadState.openChannel', () => {
  test('nunca leu: divisor aponta para a primeira mensagem do canal', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const baseTime = Date.now()
    const aId = await insertMessage(t, channelId, anaId, 'A', baseTime)
    await insertMessage(t, channelId, anaId, 'B', baseTime + 1)
    await insertMessage(t, channelId, anaId, 'C', baseTime + 2)
    await insertMessage(t, channelId, anaId, 'D', baseTime + 3)

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const result = await asAna.mutation(anyApi.channelReadState.openChannel, { channelId })

    expect(result.firstUnreadMessageId).toBe(aId)
  })

  test('chamar de novo sem mensagem nova retorna null (já leu tudo)', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const baseTime = Date.now()
    await insertMessage(t, channelId, anaId, 'A', baseTime)
    await insertMessage(t, channelId, anaId, 'B', baseTime + 1)
    await insertMessage(t, channelId, anaId, 'C', baseTime + 2)
    await insertMessage(t, channelId, anaId, 'D', baseTime + 3)

    const asAna = t.withIdentity({ subject: anaWorkosId })
    await asAna.mutation(anyApi.channelReadState.openChannel, { channelId })
    const second = await asAna.mutation(anyApi.channelReadState.openChannel, { channelId })

    expect(second.firstUnreadMessageId).toBeNull()
  })

  test('mensagem nova chega depois de ler tudo: divisor aponta para ela', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const baseTime = Date.now()
    await insertMessage(t, channelId, anaId, 'A', baseTime)
    await insertMessage(t, channelId, anaId, 'B', baseTime + 1)
    await insertMessage(t, channelId, anaId, 'C', baseTime + 2)
    await insertMessage(t, channelId, anaId, 'D', baseTime + 3)

    const asAna = t.withIdentity({ subject: anaWorkosId })
    await asAna.mutation(anyApi.channelReadState.openChannel, { channelId })

    const eId = await insertMessage(t, channelId, anaId, 'E', baseTime + 4)
    const result = await asAna.mutation(anyApi.channelReadState.openChannel, { channelId })

    expect(result.firstUnreadMessageId).toBe(eId)
  })

  test('canal sem nenhuma mensagem: retorna null sem lançar e sem criar linha em channelReadState', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)

    const asAna = t.withIdentity({ subject: anaWorkosId })
    const result = await asAna.mutation(anyApi.channelReadState.openChannel, { channelId })

    expect(result.firstUnreadMessageId).toBeNull()

    const rows = await t.run((ctx) => ctx.db.query('channelReadState').collect())
    expect(rows).toHaveLength(0)
  })

  test('SRV-06 aplicado a leitura: não-membro do servidor não consegue marcar canal como lido', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const carlaWorkosId = 'workos_carla'
    await insertUser(t, carlaWorkosId, 'carla', '0003')
    const { channelId } = await insertServerWithChannel(t, anaId)
    await insertMessage(t, channelId, anaId, 'A', Date.now())

    const asCarla = t.withIdentity({ subject: carlaWorkosId })
    await expect(
      asCarla.mutation(anyApi.channelReadState.openChannel, { channelId })
    ).rejects.toThrow()

    const rows = await t.run((ctx) => ctx.db.query('channelReadState').collect())
    expect(rows).toHaveLength(0)
  })
})

describe('channelReadState.getUnreadCounts', () => {
  test('conta corretamente não lidas de um canal nunca aberto e zero de um canal totalmente lido; ignora canal de voz', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { serverId, channelId: unreadChannelId } = await insertServerWithChannel(t, anaId)

    const readChannelId = await t.run((ctx) =>
      ctx.db.insert('channels', { serverId, name: 'lido', type: 'text', position: 1 })
    )
    const voiceChannelId = await t.run((ctx) =>
      ctx.db.insert('channels', { serverId, name: 'voz', type: 'voice', position: 2 })
    )

    const baseTime = Date.now()
    await insertMessage(t, unreadChannelId, anaId, 'A', baseTime)
    await insertMessage(t, unreadChannelId, anaId, 'B', baseTime + 1)
    await insertMessage(t, unreadChannelId, anaId, 'C', baseTime + 2)

    await insertMessage(t, readChannelId, anaId, 'X', baseTime)
    await insertMessage(t, voiceChannelId, anaId, 'não deveria existir, mas não importa', baseTime)

    const asAna = t.withIdentity({ subject: anaWorkosId })
    await asAna.mutation(anyApi.channelReadState.openChannel, { channelId: readChannelId })

    const counts: { channelId: Id<'channels'>; unreadCount: number }[] = await asAna.query(
      anyApi.channelReadState.getUnreadCounts,
      { serverId }
    )

    expect(counts).toHaveLength(2)
    const unread = counts.find((c) => c.channelId === unreadChannelId)
    const read = counts.find((c) => c.channelId === readChannelId)
    expect(unread?.unreadCount).toBe(3)
    expect(read?.unreadCount).toBe(0)
    expect(counts.some((c) => c.channelId === voiceChannelId)).toBe(false)
  })

  test('SRV-06 aplicado a badge: não-membro chamando com serverId real é rejeitado, sem vazar contagem', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const carlaWorkosId = 'workos_carla'
    await insertUser(t, carlaWorkosId, 'carla', '0003')
    const { serverId, channelId } = await insertServerWithChannel(t, anaId)
    await insertMessage(t, channelId, anaId, 'segredo', Date.now())

    const asCarla = t.withIdentity({ subject: carlaWorkosId })
    await expect(
      asCarla.query(anyApi.channelReadState.getUnreadCounts, { serverId })
    ).rejects.toThrow()
  })
})
