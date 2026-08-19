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

describe('messages.sendMessage', () => {
  test('membro válido envia mensagem — aparece com authorId correto', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await asAna.mutation(anyApi.messages.sendMessage, {
      channelId,
      content: 'Oi, pessoal!',
    })

    const messages: Doc<'messages'>[] = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(1)
    expect(messages[0].authorId).toBe(anaId)
    expect(messages[0].content).toBe('Oi, pessoal!')
    expect(messages[0].channelId).toBe(channelId)
  })

  test('rejeita envio sem identidade autenticada', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)

    await expect(
      t.mutation(anyApi.messages.sendMessage, { channelId, content: 'oi' })
    ).rejects.toThrow()

    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(0)
  })

  test('SRV-06 aplicado a chat: não-membro do servidor não consegue enviar mensagem no canal', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const carlaWorkosId = 'workos_carla'
    await insertUser(t, carlaWorkosId, 'carla', '0003')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    await expect(
      asCarla.mutation(anyApi.messages.sendMessage, { channelId, content: 'intruso' })
    ).rejects.toThrow()

    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(0)
  })

  test('rejeita mensagem vazia ou só espaços — nenhuma linha é inserida', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await expect(
      asAna.mutation(anyApi.messages.sendMessage, { channelId, content: '' })
    ).rejects.toThrow()
    await expect(
      asAna.mutation(anyApi.messages.sendMessage, { channelId, content: '   ' })
    ).rejects.toThrow()

    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(0)
  })

  test('rejeita mensagem acima de 2000 caracteres — nenhuma linha é inserida', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })

    const tooLong = 'a'.repeat(2001)
    await expect(
      asAna.mutation(anyApi.messages.sendMessage, { channelId, content: tooLong })
    ).rejects.toThrow()

    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(0)
  })

  test('rejeita envio em canal de voz mesmo sendo membro do servidor', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId, 'voice')
    const asAna = t.withIdentity({ subject: anaWorkosId })

    await expect(
      asAna.mutation(anyApi.messages.sendMessage, { channelId, content: 'oi' })
    ).rejects.toThrow()

    const messages = await t.run((ctx) => ctx.db.query('messages').collect())
    expect(messages).toHaveLength(0)
  })
})

describe('messages.listMessages', () => {
  test('SRV-06 aplicado a chat: não-membro não consegue listar mensagens, mesmo sabendo o channelId', async () => {
    const t = convexTest(schema, modules)
    const anaId = await insertUser(t, 'workos_ana', 'ana', '0001')
    const carlaWorkosId = 'workos_carla'
    await insertUser(t, carlaWorkosId, 'carla', '0003')
    const { channelId } = await insertServerWithChannel(t, anaId)
    await t.run((ctx) =>
      ctx.db.insert('messages', {
        channelId,
        authorId: anaId,
        content: 'segredo',
        createdAt: Date.now(),
      })
    )
    const asCarla = t.withIdentity({ subject: carlaWorkosId })

    await expect(
      asCarla.query(anyApi.messages.listMessages, {
        channelId,
        paginationOpts: { numItems: 30, cursor: null },
      })
    ).rejects.toThrow()
  })

  test('mensagem enviada por Ana aparece com isMine correto para cada chamador', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const brunoWorkosId = 'workos_bruno'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const brunoId = await insertUser(t, brunoWorkosId, 'bruno', '0002')
    const { serverId, channelId } = await insertServerWithChannel(t, anaId)
    await addMember(t, serverId, brunoId)

    const asAna = t.withIdentity({ subject: anaWorkosId })
    await asAna.mutation(anyApi.messages.sendMessage, { channelId, content: 'Oi, Bruno!' })

    const asBruno = t.withIdentity({ subject: brunoWorkosId })

    const anaView = await asAna.query(anyApi.messages.listMessages, {
      channelId,
      paginationOpts: { numItems: 30, cursor: null },
    })
    const brunoView = await asBruno.query(anyApi.messages.listMessages, {
      channelId,
      paginationOpts: { numItems: 30, cursor: null },
    })

    expect(anaView.page).toHaveLength(1)
    expect(anaView.page[0].isMine).toBe(true)
    expect(brunoView.page[0].isMine).toBe(false)
  })

  test('autor da mensagem vem com username/tag/displayName corretos e sem workosId', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)
    const asAna = t.withIdentity({ subject: anaWorkosId })
    await asAna.mutation(anyApi.messages.sendMessage, { channelId, content: 'oi' })

    const view = await asAna.query(anyApi.messages.listMessages, {
      channelId,
      paginationOpts: { numItems: 30, cursor: null },
    })

    expect(view.page[0].author).not.toBeNull()
    expect(view.page[0].author?.username).toBe('ana')
    expect(view.page[0].author?.tag).toBe('0001')
    expect(view.page[0].author?.displayName).toBe('ana')
    expect(view.page[0].author).not.toHaveProperty('workosId')
  })

  test('paginação: 35 mensagens — primeira página traz 30, mais nova primeiro, cursor traz o resto', async () => {
    const t = convexTest(schema, modules)
    const anaWorkosId = 'workos_ana'
    const anaId = await insertUser(t, anaWorkosId, 'ana', '0001')
    const { channelId } = await insertServerWithChannel(t, anaId)

    const baseTime = Date.now()
    for (let i = 0; i < 35; i++) {
      await t.run((ctx) =>
        ctx.db.insert('messages', {
          channelId,
          authorId: anaId,
          content: `mensagem ${i}`,
          createdAt: baseTime + i,
        })
      )
    }

    const asAna = t.withIdentity({ subject: anaWorkosId })

    const firstPage = await asAna.query(anyApi.messages.listMessages, {
      channelId,
      paginationOpts: { numItems: 30, cursor: null },
    })

    expect(firstPage.page).toHaveLength(30)
    expect(firstPage.isDone).toBe(false)
    expect(firstPage.page[0].content).toBe('mensagem 34')
    expect(firstPage.page[29].content).toBe('mensagem 5')

    const secondPage = await asAna.query(anyApi.messages.listMessages, {
      channelId,
      paginationOpts: { numItems: 30, cursor: firstPage.continueCursor },
    })

    expect(secondPage.page).toHaveLength(5)
    expect(secondPage.isDone).toBe(true)
    expect(secondPage.page[0].content).toBe('mensagem 4')
    expect(secondPage.page[4].content).toBe('mensagem 0')
  })
})
